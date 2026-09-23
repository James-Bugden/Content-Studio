/**
 * Public CI runs with synthetic data only. Anything needing a live credential must
 * fail loudly rather than silently reach a real Sheet, Drive, Typefully or model.
 */
process.env.CS_DATA_MODE ??= 'fake';
process.env.APP_TIMEZONE ??= 'Asia/Taipei';
process.env.APP_BASE_URL ??= 'http://localhost:3000';
process.env.AI_PROVIDER ??= 'fake';

for (const forbidden of ['AI_API_KEY', 'TYPEFULLY_API_KEY', 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY', 'AUTH_GOOGLE_SECRET']) {
  if (process.env[forbidden]) {
    throw new Error(`${forbidden} is set while running tests. Tests must never hold a live credential.`);
  }
}
