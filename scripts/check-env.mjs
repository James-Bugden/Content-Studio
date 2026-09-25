#!/usr/bin/env node
/**
 * Environment validation (CS-001). Prints variable NAMES and presence only, never values.
 *
 * In `live` mode every provider name must be present. In `fake` mode no provider
 * credential may be present, so a synthetic run can never reach a real service.
 */
const mode = process.env.CS_DATA_MODE ?? 'fake';
const LIVE_REQUIRED = [
  'AUTH_SECRET',
  'AUTH_GOOGLE_ID',
  'AUTH_GOOGLE_SECRET',
  'CS_OWNER_GOOGLE_SUB',
  'GOOGLE_SERVICE_ACCOUNT_EMAIL',
  'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
  'CS_SHEET_ID',
];
const OPTIONAL = [
  'TYPEFULLY_API_KEY',
  'TYPEFULLY_SOCIAL_SET_ID',
  'AI_API_KEY',
  'CS_VIEWER_GOOGLE_SUBS',
  'CS_DRIVE_ROOT_FOLDER_ID',
  'CS_ASSET_FOLDER_ID',
  'SUPABASE_READ_MODEL_MODE',
  'SUPABASE_READ_MODEL_URL',
  'SUPABASE_READ_MODEL_SERVICE_KEY',
  'SUPABASE_READ_MODEL_SOURCE_KEY',
];
const FORBIDDEN_IN_FAKE = ['GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY', 'TYPEFULLY_API_KEY', 'AI_API_KEY', 'SUPABASE_READ_MODEL_SERVICE_KEY'];

const problems = [];
if (!['fake', 'live'].includes(mode)) problems.push(`CS_DATA_MODE must be "fake" or "live"`);
if (mode === 'fake' && process.env.VERCEL_ENV === 'production') problems.push('CS_DATA_MODE=fake is refused in production');
if (mode === 'live') {
  for (const name of LIVE_REQUIRED) if (!process.env[name]) problems.push(`missing ${name}`);
}
const mirrorMode = process.env.SUPABASE_READ_MODEL_MODE ?? 'off';
if (!['off', 'mirror', 'shadow'].includes(mirrorMode)) problems.push('SUPABASE_READ_MODEL_MODE must be "off", "mirror" or "shadow"');
if (mirrorMode !== 'off') {
  for (const name of ['SUPABASE_READ_MODEL_URL', 'SUPABASE_READ_MODEL_SERVICE_KEY', 'SUPABASE_READ_MODEL_SOURCE_KEY']) {
    if (!process.env[name]) problems.push(`missing ${name}`);
  }
}
if (mode === 'fake') {
  for (const name of FORBIDDEN_IN_FAKE) if (process.env[name]) problems.push(`${name} must not be set in fake mode`);
}

console.log(`mode: ${mode}`);
for (const name of [...LIVE_REQUIRED, ...OPTIONAL]) console.log(`  ${name}: ${process.env[name] ? 'set' : 'unset'}`);
if (problems.length > 0) {
  console.error(`env check: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('env check: ok');
