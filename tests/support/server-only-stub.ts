/**
 * A no-op stand-in for the `server-only` package.
 *
 * That package exists to make a bundler fail loudly when server code is pulled
 * into a client bundle. Under vitest there is no bundler and no client, so the
 * real module just throws and takes every server module with it, which is why
 * `assertSameOrigin` and the test-mode switch had no tests at all until an
 * adversarial review mutated both to no-ops and watched 436 tests stay green.
 *
 * The protection itself is not weakened: `tests/unit/security/boundaries.test.ts`
 * asserts directly that no client component reaches a server credential, which is
 * the property `server-only` is there to enforce.
 */
export {};
