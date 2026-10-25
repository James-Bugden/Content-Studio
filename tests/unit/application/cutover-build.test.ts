import { expect, it } from 'vitest';
import { assertExpectedCutoverBuild } from '@/application/cutover-build';

const build = 'a'.repeat(40);
it.each([undefined, null, 1, '', 'g'.repeat(40), build.toUpperCase(), build.slice(0,39), build+'a', ' '+build, build+'\n'])('build binding: rejects invalid expected SHA %s', expected => {
  expect(() => assertExpectedCutoverBuild(expected, build)).toThrow(expect.objectContaining({ code: 'GATE_BLOCKED', details: { reason: 'cutover_expected_build_invalid' } }));
});
it.each([build.slice(0,39)+'b', build.toUpperCase(), ' '+build, build+'\n', build.slice(0,39), ''])('build binding: compares the entire server SHA without normalization %s', deployed => {
  expect(() => assertExpectedCutoverBuild(build, deployed)).toThrow(expect.objectContaining({ code: 'CONFLICT', details: { reason: 'cutover_build_mismatch' } }));
});
it('build binding: admits exact full SHA', () => {
  expect(() => assertExpectedCutoverBuild(build, build)).not.toThrow();
});
