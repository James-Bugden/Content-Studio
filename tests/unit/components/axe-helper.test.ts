import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ poll: vi.fn(), ready: false, analyze: vi.fn(), tags: vi.fn() }));
vi.mock('@playwright/test', () => ({ expect: { poll: state.poll } }));
vi.mock('@axe-core/playwright', () => ({ default: class {
  withTags(tags: string[]) { state.tags(tags); return this; }
  analyze() { expect(state.ready).toBe(true); return state.analyze(); }
} }));
import { scanAxe } from '../../e2e/support/axe';
it('CS-059j: axe waits for a nonempty title before analysis and preserves caller tags', async () => {
  const title = vi.fn().mockResolvedValue('Posts');
  state.poll.mockImplementation((read, options) => {
    expect(options.message).toBe('document title is set before the axe scan');
    return { not: { toBe: async (empty: string) => { expect(empty).toBe(''); expect(await read()).toBe('Posts'); state.ready = true; } } };
  });
  state.analyze.mockResolvedValue({ violations: [{ id: 'synthetic' }] });
  expect(await scanAxe({ title } as never, ['wcag2a'])).toEqual({ violations: [{ id: 'synthetic' }] });
  expect(state.tags).toHaveBeenCalledWith(['wcag2a']);
  expect(title).toHaveBeenCalledOnce();
});
