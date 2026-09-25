// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Gate } from '@/domain/gates';
import { GateChip, NextAction, StatusBadge } from '@/components/status';

afterEach(cleanup);

const gate = (over: Partial<Gate>): Gate => ({
  code: 'REVIEW_PENDING',
  severity: 'hard',
  field: 'Review Status',
  message: 'Waiting for review.',
  nextAction: 'Review and approve, or request changes',
  human: true,
  ...over,
});

describe('StatusBadge (UX-02: never colour only)', () => {
  it.each([
    ['ready', 'Ready'],
    ['needs_action', 'Needs action'],
    ['blocked', 'Blocked'],
  ] as const)('%s shows the visible word %s and a hidden glyph', (status, label) => {
    const { container } = render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeTruthy();
    const glyph = container.querySelector('[aria-hidden="true"]');
    expect(glyph?.textContent?.trim()).not.toBe('');
    // The accessible text is the label, not the glyph.
    expect(container.textContent?.replace(glyph?.textContent ?? '', '').trim()).toBe(label);
  });

  it('uses a different glyph for each status', () => {
    const glyphs = (['ready', 'needs_action', 'blocked'] as const).map((s) => {
      const { container, unmount } = render(<StatusBadge status={s} />);
      const g = container.querySelector('[aria-hidden="true"]')?.textContent;
      unmount();
      return g;
    });
    expect(new Set(glyphs).size).toBe(3);
  });

  it('uses the green/yellow/red semantic scale with words and shapes (THEME-02)', () => {
    const classes = (['ready', 'needs_action', 'blocked'] as const).map((status) => {
      const { container, unmount } = render(<StatusBadge status={status} />);
      const className = container.firstElementChild?.getAttribute('class') ?? '';
      unmount();
      return className;
    });
    expect(classes[0]).toContain('bg-green-soft');
    expect(classes[1]).toContain('bg-attention-soft');
    expect(classes[2]).toContain('bg-block-soft');
  });
});

describe('GateChip', () => {
  it('labels a hard stop as Blocked, an ordinary step as Needs action and a soft gate as Warning', () => {
    render(
      <>
        <GateChip gate={gate({ code: 'DUPLICATE_CHECK', field: 'Duplicate QA', message: 'A possible duplicate needs a decision.' })} />
        <GateChip gate={gate({})} />
        <GateChip gate={gate({ code: 'APPROVAL_LEGACY', severity: 'soft', message: 'Approved outside.' })} />
      </>,
    );
    expect(screen.getByText('Blocked')).toBeTruthy();
    expect(screen.getByText('Needs action')).toBeTruthy();
    expect(screen.getByText('Warning')).toBeTruthy();
    expect(screen.getByText(/Duplicate QA: A possible duplicate needs a decision\./)).toBeTruthy();
  });
});

describe('NextAction', () => {
  it('names the single next action and why', () => {
    render(<NextAction gate={gate({})} />);
    expect(screen.getByText('Next action')).toBeTruthy();
    expect(screen.getByText('Review and approve, or request changes')).toBeTruthy();
    expect(screen.getByText(/Why: Waiting for review\./)).toBeTruthy();
  });

  it('says nothing is left to do when there is no gate', () => {
    render(<NextAction gate={null} />);
    expect(screen.getByText(/Nothing to do here/)).toBeTruthy();
  });
});
