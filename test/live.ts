/**
 * End-to-end and integration tests call the real pinned model; nothing is mocked.
 * Without a key they can't run: CI fails loudly, a local run skips them and says so.
 */
export const hasModel = Boolean(process.env.TYPESAFE_API_KEY);

if (!hasModel) {
  if (process.env.CI)
    throw new Error(
      'TYPESAFE_API_KEY is required in CI: e2e and integration tests call the real model.',
    );
  console.warn(
    'TYPESAFE_API_KEY not set: skipping e2e and integration tests, which call the real model.',
  );
}
