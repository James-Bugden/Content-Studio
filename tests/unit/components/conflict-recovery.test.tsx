// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ConflictDialog } from '@/components/conflict-dialog';
import { RecoveryPanel, STEP_LOOK, type RecoveryStep } from '@/components/recovery-panel';

afterEach(cleanup);

const base = 'Line one.\n\nLine two.';
const current = 'Line one changed.\n\n談薪水不是吵架。 \u{1F4B8}\n';
const proposed = '  Leading spaces kept.\nLine one.\n\n\nThree newlines above. \u{1F91D}\n談薪水不是吵架：先準備好你的市場行情。';

function pane(label: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-pane="${label}"]`);
  if (!el) throw new Error(`pane ${label} not rendered`);
  return el;
}

describe('ConflictDialog', () => {
  it('shows each version exactly, including CJK, emoji, spaces and line breaks', () => {
    render(<ConflictDialog open onClose={() => {}} base={base} current={current} proposed={proposed} actions={[]} />);
    expect(pane('Base').textContent).toBe(base);
    expect(pane('Current').textContent).toBe(current);
    expect(pane('Proposed').textContent).toBe(proposed);
    expect(screen.getByRole('heading', { name: /Base/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Current \(source now\)/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Proposed \(your edit\)/ })).toBeTruthy();
  });

  it('omits the base pane when the base could not be loaded, and says so', () => {
    render(<ConflictDialog open onClose={() => {}} base={null} current={current} proposed={proposed} actions={[]} />);
    expect(document.querySelector('[data-pane="Base"]')).toBeNull();
    expect(screen.getByText(/could not be loaded/)).toBeTruthy();
  });

  it('runs only the action the user chooses, and Escape just closes', () => {
    const keep = vi.fn();
    const use = vi.fn();
    const onClose = vi.fn();
    render(
      <ConflictDialog
        open
        onClose={onClose}
        base={base}
        current={current}
        proposed={proposed}
        actions={[
          { label: 'Keep mine and review again', onSelect: keep },
          { label: 'Use current', onSelect: use },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Keep mine and review again' }));
    expect(keep).toHaveBeenCalledTimes(1);
    expect(use).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('dialog', { hidden: true }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(keep).toHaveBeenCalledTimes(1);
  });

  it('renders nothing inside the dialog while closed', () => {
    render(<ConflictDialog open={false} onClose={() => {}} base={base} current={current} proposed={proposed} actions={[]} />);
    expect(document.querySelector('[data-pane]')).toBeNull();
  });
});

describe('RecoveryPanel', () => {
  const steps: RecoveryStep[] = [
    { step: 'Update the Markdown section', status: 'done', provider: 'Drive' },
    { step: 'Update Draft Content', status: 'skipped_already_applied', provider: 'Sheet' },
    { step: 'Update the Typefully draft', status: 'failed', provider: 'Typefully' },
    { step: 'Record final-sync time', status: 'pending', provider: 'Sheet' },
  ];

  it('shows every step with its true status as text', () => {
    render(<RecoveryPanel operationId="op-synthetic-1" steps={steps} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(4);
    steps.forEach((s, i) => {
      expect(items[i]?.textContent).toContain(s.step);
      expect(items[i]?.textContent).toContain(s.provider);
      expect(items[i]?.textContent).toContain(STEP_LOOK[s.status].label);
    });
    expect(screen.getByText(/2 of 4 steps finished, 1 failed/)).toBeTruthy();
    expect(screen.getByText('op-synthetic-1')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers retry only while steps remain', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<RecoveryPanel operationId="op-1" steps={steps} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry remaining steps' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    rerender(<RecoveryPanel operationId="op-1" steps={steps.slice(0, 2)} onRetry={onRetry} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('All steps finished')).toBeTruthy();
  });
});
