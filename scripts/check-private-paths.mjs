#!/usr/bin/env node
/**
 * Tracked-private-data policy check (CS-001, SEC-01).
 *
 * Three separate guarantees:
 *  1. No Git-tracked file sits on a private path (corpora, exports, auth state, traces).
 *  2. `.gitignore` still covers every private pattern this policy depends on.
 *  3. `.env.example` lists names only: every secret or private name has a blank value.
 *
 * This is a policy check, not a secret scanner. `scripts/scan-secrets.mjs` inspects
 * file contents; this one inspects what is tracked and how the repo is configured.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const NUL = String.fromCharCode(0);

const FORBIDDEN_TRACKED = [
  { id: 'private-dir', re: /(^|\/)private\// },
  { id: 'private-fixtures', re: /^(fixtures|tests\/fixtures)\/private\// },
  { id: 'private-eval-set', re: /^tests\/evals\/private\// },
  { id: 'auth-state', re: /(^|\/)(playwright\/\.auth|\.auth)\// },
  { id: 'storage-state', re: /(^|\/)(storage-state|cookies)[^/]*\.json$/ },
  { id: 'env-file', re: /(^|\/)\.env(\.|$)(?!example)/ },
  { id: 'key-material', re: /\.(pem|key|p12|pfx)$/ },
  { id: 'sqlite-db', re: /\.sqlite3?$/ },
  { id: 'vercel-dir', re: /^\.vercel\// },
  { id: 'test-artifacts', re: /^(test-results|playwright-report|traces|artifacts)\// },
  // Scratch files a reviewer or a debugging session left behind. They are not
  // private data, but they are not the project either: they get committed by an
  // over-eager `git add -A` while something else is mid-flight, and then they fail
  // CI for reasons that have nothing to do with the change under review.
  { id: 'scratch-file', re: /(^|\/)(tmp-|__zz|scratch[-.]|repro-)/ },
  { id: 'scratch-suffix', re: /\.(scratch|tmp|bak|orig)\.[a-z]+$/ },
];

const REQUIRED_IGNORES = [
  '.env',
  '.env.*',
  'private/',
  '**/private/',
  'fixtures/private/',
  'tests/evals/private/',
  'playwright/.auth/',
  'test-results/',
  'playwright-report/',
  'traces/',
  '*.pem',
  '*.key',
];

// Names in .env.example that must never carry a value in a public repository.
const MUST_BE_BLANK = [
  'AUTH_SECRET',
  'AUTH_GOOGLE_ID',
  'AUTH_GOOGLE_SECRET',
  'CS_OWNER_GOOGLE_SUB',
  'CS_OWNER_EMAIL',
  'CS_VIEWER_GOOGLE_SUBS',
  'GOOGLE_SERVICE_ACCOUNT_EMAIL',
  'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
  'CS_SHEET_ID',
  'CS_DRIVE_ROOT_FOLDER_ID',
  'CS_ASSET_FOLDER_ID',
  'CS_HOOK_REFERENCE_FILE_IDS',
  'TYPEFULLY_API_KEY',
  'TYPEFULLY_SOCIAL_SET_ID',
  'AI_API_KEY',
];

// Every name the runtime reads must be declared in the template.
const REQUIRED_ENV_NAMES = [
  'CS_DATA_MODE',
  'APP_BASE_URL',
  'APP_TIMEZONE',
  ...MUST_BE_BLANK,
  'GOOGLE_WRITE_ENABLED',
  'AI_PROVIDER',
  'AI_MODEL',
];

const problems = [];

const tracked = execFileSync('git', ['ls-files', '-z'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
  .split(NUL)
  .filter(Boolean);

for (const file of tracked) {
  for (const rule of FORBIDDEN_TRACKED) {
    if (rule.re.test(file)) problems.push(`tracked private path (${rule.id}): ${file}`);
  }
}

const gitignore = existsSync('.gitignore') ? readFileSync('.gitignore', 'utf8').split('\n').map((l) => l.trim()) : [];
for (const pattern of REQUIRED_IGNORES) {
  if (!gitignore.includes(pattern)) problems.push(`.gitignore is missing required pattern: ${pattern}`);
}

if (!existsSync('.env.example')) {
  problems.push('.env.example is missing: it is the canonical name list');
} else {
  const lines = readFileSync('.env.example', 'utf8').split('\n');
  const declared = new Set();
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) {
      problems.push(`.env.example line is not NAME=value: ${line}`);
      continue;
    }
    const name = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    declared.add(name);
    if (MUST_BE_BLANK.includes(name) && value !== '') {
      problems.push(`.env.example must leave ${name} blank in a public repository`);
    }
  }
  for (const name of REQUIRED_ENV_NAMES) {
    if (!declared.has(name)) problems.push(`.env.example does not declare required name: ${name}`);
  }
}

if (problems.length > 0) {
  console.error(`private-path policy: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

console.log(`private-path policy: clean (${tracked.length} tracked files)`);
