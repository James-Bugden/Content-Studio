import { describe, it, expect, vi, afterEach } from 'vitest';
import { toErrorResponse } from '@/replies/lib/server/http';
import { AppError, looksLikeSqlState, recoverAppErrorCode } from '@/replies/lib/contracts/errors';

/**
 * How a thrown error becomes a status code.
 *
 * This had no tests, and the gap cost a real defect: every deliberate 409, 401
 * and 429 raised by the store was returned as a 500 reading "Something went
 * wrong", so a version conflict looked like a crash and optimistic concurrency
 * was silently dead across the whole app.
 *
 * It took two mistakes at once. `instanceof AppError` was false in the production
 * build, because Next hands a server component and a route handler separate copies
 * of the module and the store was constructed by one while the route caught from
 * the other. That alone would have been survivable. But the fall-through read any
 * string `code` as a SQLSTATE, and an AppError carries a `code` too, so
 * `version_conflict` was mapped as a database state, matched nothing, and
 * defaulted to `internal_error`. The first bug produced the wrong branch; the
 * second one made it silent.
 *
 * Both are closed here, and each is tested separately so that fixing one and
 * regressing the other cannot pass.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

async function classify(error: unknown) {
  // The classifier logs unexpected errors on purpose. Silence it here so a
  // deliberate failure case does not look like a broken test run.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const response = toErrorResponse(error, 'req-1');
  return { status: response.status, body: (await response.json()) as { code: string; message: string } };
}

describe('an AppError keeps its own code', () => {
  it('returns the status and message it was given', async () => {
    const { status, body } = await classify(
      new AppError('version_conflict', 'This changed somewhere else. Check the latest version before saving.'),
    );

    expect(status).toBe(409);
    expect(body.code).toBe('version_conflict');
    expect(body.message).toBe('This changed somewhere else. Check the latest version before saving.');
  });

  it.each([
    ['unauthenticated', 401],
    ['forbidden', 403],
    ['not_found', 404],
    ['payload_too_large', 413],
    ['rate_limited', 429],
  ] as const)('maps %s to %d', async (code, status) => {
    expect((await classify(new AppError(code, 'x'))).status).toBe(status);
  });

  it('survives arriving from a different copy of the module', async () => {
    // The production failure, reproduced: same brand, different class object, so
    // `instanceof` is false and only the brand can recognise it.
    const fromAnotherChunk = Object.assign(new Error('from elsewhere'), {
      [Symbol.for('social-replies.AppError')]: true,
      code: 'version_conflict',
      name: 'AppError',
    });

    expect(fromAnotherChunk instanceof AppError).toBe(false);
    const { status, body } = await classify(fromAnotherChunk);
    expect(status).toBe(409);
    expect(body.code).toBe('version_conflict');
    // The message is what separates this from the unbranded fall-back below.
    // Both answer 409, so without this line an `instanceof` check would pass
    // here by being rescued by the recovery branch, and the two halves of the
    // fix could not be regressed independently.
    expect(body.message).toBe('from elsewhere');
  });

  it('recovers one that lost its brand entirely', async () => {
    // Serialised across a boundary, or produced by a bundler doing something new.
    const unbranded = Object.assign(new Error('a message from nowhere'), {
      name: 'AppError',
      code: 'not_found',
    });

    const { status, body } = await classify(unbranded);
    expect(status).toBe(404);
    // The code is trusted from the shape; the message is not, because an
    // unbranded object's text has unknown provenance.
    expect(body.message).not.toBe('a message from nowhere');
  });
});

describe('the SQLSTATE branch cannot swallow an application code', () => {
  it('never reads a non-SQLSTATE string as a database state', () => {
    // This is the exact trap. `version_conflict` is a string and it was a `code`,
    // so the old classifier handed it to the SQLSTATE mapper, which matched
    // nothing and defaulted to internal_error.
    expect(looksLikeSqlState('version_conflict')).toBe(false);
    expect(looksLikeSqlState('idempotency_conflict')).toBe(false);
    expect(looksLikeSqlState('ECONNREFUSED')).toBe(false);
    expect(looksLikeSqlState('23505')).toBe(true);
    expect(looksLikeSqlState('SR409')).toBe(true);
  });

  it('classifies an error carrying an application code but no AppError shape as internal', async () => {
    // A third-party error that happens to have `code: 'version_conflict'` is not
    // this app's error and must not be answered as though it were.
    const { status, body } = await classify({ code: 'version_conflict', message: 'not ours' });

    expect(status).toBe(500);
    expect(body.code).toBe('internal_error');
    expect(body.message).not.toContain('not ours');
  });

  it('says which kind of unknown it was, because they are different problems', async () => {
    // Both answer 500, so the only way this guard can be checked at all is by
    // what it writes down. An unmapped SQLSTATE means the database did something
    // unaccounted for; an unrecognised code means the error came from somewhere
    // whose conventions this app does not know.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    toErrorResponse({ code: 'XX000' }, 'req-sqlstate');
    toErrorResponse({ code: 'ECONNREFUSED' }, 'req-foreign');

    const lines = logged.mock.calls.map((call) => String(call[0]));
    expect(lines.find((line) => line.includes('req-sqlstate'))).toContain('unmapped SQLSTATE');
    expect(lines.find((line) => line.includes('req-foreign'))).toContain(
      'unrecognised error code, not a SQLSTATE',
    );
  });

  it('still maps a real SQLSTATE', async () => {
    expect((await classify({ code: 'SR409' })).body.code).toBe('version_conflict');
    expect((await classify({ code: 'SR404' })).body.code).toBe('not_found');
    expect((await classify({ code: '23503' })).body.code).toBe('validation_failed');
    expect((await classify({ code: '42501' })).body.code).toBe('forbidden');
  });

  it('treats an unknown but SQLSTATE-shaped code as internal, without echoing it', async () => {
    const { status, body } = await classify({ code: 'XX000', message: 'relation "facts" does not exist' });

    expect(status).toBe(500);
    expect(body.code).toBe('internal_error');
    // A database message can name another record's existence, so it never leaves.
    expect(body.message).not.toContain('facts');
  });
});

describe('recoverAppErrorCode', () => {
  it('refuses anything that is not shaped like one of this app\'s errors', () => {
    expect(recoverAppErrorCode(null)).toBeNull();
    expect(recoverAppErrorCode('version_conflict')).toBeNull();
    expect(recoverAppErrorCode({ code: 'version_conflict' })).toBeNull();
    expect(recoverAppErrorCode({ name: 'AppError' })).toBeNull();
    expect(recoverAppErrorCode({ name: 'TypeError', code: 'version_conflict' })).toBeNull();
    expect(recoverAppErrorCode({ name: 'AppError', code: 'not_a_real_code' })).toBeNull();
  });

  it('accepts one that is', () => {
    expect(recoverAppErrorCode({ name: 'AppError', code: 'rate_limited' })).toBe('rate_limited');
  });
});

describe('everything else', () => {
  it('is an internal error with a generic message', async () => {
    const { status, body } = await classify(new TypeError('cannot read properties of undefined'));

    expect(status).toBe(500);
    expect(body.code).toBe('internal_error');
    expect(body.message).not.toContain('undefined');
  });

  it('carries the request id so a log line can be tied to what the owner saw', async () => {
    const response = toErrorResponse(new AppError('not_found', 'x'), 'req-42');
    expect(((await response.json()) as { request_id: string }).request_id).toBe('req-42');
  });
});

