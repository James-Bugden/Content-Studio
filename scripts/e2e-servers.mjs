// Build once; run the same artifact with separate Sheet/shadow runtime envs.
// Playwright owns this process and both child servers.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const next = require.resolve('next/dist/bin/next');
const children = new Set();
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exit(code);
}
process.on('SIGTERM', () => stop());
process.on('SIGINT', () => stop());
function launch(args, env = process.env) {
  const child = spawn(process.execPath, [next, ...args], { stdio: 'inherit', env });
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
}
if (!['sheet', 'db-read', 'db'].includes(process.env.CS_E2E_CONTENT_STORE ?? 'sheet')) throw new Error('Invalid synthetic e2e store');
const build = launch(['build']);
const code = await new Promise(resolve => build.once('exit', resolve));
if (code !== 0) stop(1);
const sheet = launch(['start', '--port', '3200', '--hostname', '127.0.0.1'], { ...process.env, CS_CONTENT_STORE: process.env.CS_E2E_CONTENT_STORE ?? 'sheet', APP_BASE_URL: 'http://127.0.0.1:3200' });
sheet.once('exit', () => stop(1));
// Start shadow only after Sheet is ready, so Playwright's shadow health URL
// also proves that the Sheet suite can start safely.
const deadline = Date.now() + 60_000;
while (true) {
  try { if ((await fetch('http://127.0.0.1:3200/api/health')).ok) break; } catch { /* starting */ }
  if (Date.now() >= deadline) stop(1);
  await new Promise(resolve => setTimeout(resolve, 250));
}
const shadow = launch(['start', '--port', '3201', '--hostname', '127.0.0.1'], { ...process.env, CS_CONTENT_STORE: 'db-shadow', APP_BASE_URL: 'http://127.0.0.1:3201' });
shadow.once('exit', () => stop(1));
