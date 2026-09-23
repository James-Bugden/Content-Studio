#!/usr/bin/env node
/**
 * Secret scanner for a public repository (CS-001, SEC-01).
 *
 * Scans Git-tracked files by default. Pass explicit paths to scan an isolated
 * directory, which is how the sentinel test proves the scanner actually fires
 * without committing a real credential anywhere.
 *
 *   node scripts/scan-secrets.mjs              # tracked files
 *   node scripts/scan-secrets.mjs path [path]  # explicit paths
 *
 * Exit code 0 means no finding. Exit code 1 means at least one finding. The
 * report prints the rule, file and line but never the matched value.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const RULES = [
  { id: 'private-key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { id: 'aws-access-key-id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { id: 'openai-key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/ },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'google-oauth-client-secret', re: /\bGOCSPX-[A-Za-z0-9_-]{20,}\b/ },
  { id: 'google-oauth-refresh-token', re: /\b1\/\/0[A-Za-z0-9_-]{30,}\b/ },
  { id: 'google-service-account-json', re: /"type"\s*:\s*"service_account"/ },
  { id: 'typefully-key-assignment', re: /TYPEFULLY_API_KEY\s*=\s*\S{12,}/ },
  // A real Drive/Docs/Sheets identifier in a URL. Synthetic fixtures use ids that
  // start with SYNTH so they are visibly fake and never match this rule.
  {
    id: 'google-drive-id-url',
    re: /\b(?:docs|drive|sheets)\.google\.com\/(?:[a-z]+\/)*(?:d\/|folders\/|open\?id=)(?!SYNTH)[A-Za-z0-9_-]{20,}/,
  },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { id: 'postgres-url-with-password', re: /\bpostgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/ },
  { id: 'url-with-credentials', re: /\bhttps?:\/\/[^\s:@/]+:[^\s@/]+@[^\s/]+/ },
  // Owner identifiers must not be committed to a public repo (AGENTS.md).
  {
    id: 'email-address',
    re: /\b[A-Za-z0-9._%+-]+@(?!example\.(?:com|org|net)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
  },
  // Deliberate marker used only by the isolated scanner test.
  { id: 'test-sentinel', re: /CS_SECRET_SENTINEL_[A-Z0-9]{8}/ },
];

// Files that legitimately document the shape of a secret without containing one.
const ALLOWLIST = new Map([
  ['scripts/scan-secrets.mjs', new Set(RULES.map((r) => r.id))],
  ['tests/unit/security/secret-scanner.test.ts', new Set(['test-sentinel'])],
]);

const BINARY_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.pdf',
  '.zip',
]);
const MAX_BYTES = 2_000_000;
const NUL = String.fromCharCode(0);

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split(NUL).filter(Boolean);
}

function walk(root) {
  const found = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    const info = statSync(current);
    if (info.isDirectory()) {
      if (/(^|[\\/])(node_modules|\.git|\.next)$/.test(current)) continue;
      for (const entry of readdirSync(current)) stack.push(join(current, entry));
    } else if (info.isFile()) {
      found.push(current);
    }
  }
  return found;
}

function scan(files, { cwd = process.cwd(), useAllowlist = true } = {}) {
  const findings = [];
  for (const file of files) {
    const key = relative(cwd, file).split(sep).join('/');
    const dot = key.lastIndexOf('.');
    if (dot >= 0 && BINARY_EXT.has(key.slice(dot).toLowerCase())) continue;
    let size = 0;
    try {
      size = statSync(file).size;
    } catch {
      continue;
    }
    if (size > MAX_BYTES) continue;
    let text = '';
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (text.includes(NUL)) continue;
    const exempt = useAllowlist ? (ALLOWLIST.get(key) ?? new Set()) : new Set();
    const lines = text.split('\n');
    for (const rule of RULES) {
      if (exempt.has(rule.id)) continue;
      for (let i = 0; i < lines.length; i += 1) {
        if (rule.re.test(lines[i])) findings.push({ rule: rule.id, file: key, line: i + 1 });
      }
    }
  }
  return findings;
}

export { scan, walk, RULES };

const invokedDirectly =
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const files =
    args.length > 0 ? args.flatMap((a) => (statSync(a).isDirectory() ? walk(a) : [a])) : trackedFiles();
  const findings = scan(files, { useAllowlist: args.length === 0 });
  if (findings.length > 0) {
    console.error(`secret scan: ${findings.length} finding(s)`);
    for (const f of findings) console.error(`  ${f.rule}  ${f.file}:${f.line}`);
    console.error('Values are not printed. Rotate anything real, then remove it from history.');
    process.exit(1);
  }
  console.log(`secret scan: clean (${files.length} files)`);
}
