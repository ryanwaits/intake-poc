/**
 * End-to-end and integration tests call the real pinned models; nothing is mocked.
 * Without credentials they can't run: CI fails loudly, a local run skips them and says so.
 */
const REQUIRED = ['TYPESAFE_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'];
const missing = REQUIRED.filter((name) => !process.env[name]);

export const hasModel = missing.length === 0;

if (!hasModel) {
  const what = `${missing.join(', ')} not set`;
  if (process.env.CI) {
    throw new Error(
      `${what}: required in CI, since e2e and integration tests call the real models.`,
    );
  }
  console.warn(`${what}: skipping e2e and integration tests, which call the real models.`);
}
