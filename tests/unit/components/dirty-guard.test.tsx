// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/review',
  useSearchParams: () => new URLSearchParams(),
}));

import { GuardedLink } from '@/components/guarded-link';
import { useDirtyGuard } from '@/components/use-dirty-guard';
import { resetDirtyStoreForTests } from '@/components/dirty-store';

function Editor({ dirty }: { dirty: boolean }) {
  const { confirmLeave } = useDirtyGuard(dirty);
  const [safe, setSafe] = useState('');
  return (
    <>
      <GuardedLink href="/ready" data-testid="leave">
        Go to Ready
      </GuardedLink>
      <button type="button" onClick={() => setSafe(String(confirmLeave()))}>
        Check
      </button>
      <output data-testid="safe">{safe}</output>
    </>
  );
}

/** Asks the hook whether leaving is safe right now. */
function confirmLeaveResult(): string {
  fireEvent.click(screen.getByRole('button', { name: 'Check' }));
  return screen.getByTestId('safe').textContent ?? '';
}

function fireBeforeUnload(): Event {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  nav.push.mockReset();
  resetDirtyStoreForTests();
});
afterEach(cleanup);

describe('useDirtyGuard + GuardedLink (UX-04)', () => {
  it('does not ask when the editor is clean', () => {
    render(<Editor dirty={false} />);
    const link = screen.getByTestId('leave');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(click);
    expect(screen.queryByText('Leave without saving?')).toBeNull();
    expect(confirmLeaveResult()).toBe('true');
    expect(fireBeforeUnload().defaultPrevented).toBe(false);
  });

  it('asks before leaving when dirty, and staying keeps the user in place', () => {
    render(<Editor dirty />);
    expect(confirmLeaveResult()).toBe('false');
    fireEvent.click(screen.getByTestId('leave'));
    expect(screen.getByText('Leave without saving?')).toBeTruthy();
    expect(nav.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Stay and keep editing' }));
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.queryByText('Leave without saving?')).toBeNull();
  });

  it('navigates only after the explicit leave choice', () => {
    render(<Editor dirty />);
    fireEvent.click(screen.getByTestId('leave'));
    fireEvent.click(screen.getByRole('button', { name: 'Leave and discard changes' }));
    expect(nav.push).toHaveBeenCalledWith('/ready');
  });

  it('registers beforeunload only while dirty, and releases it after save', () => {
    const { rerender } = render(<Editor dirty />);
    expect(fireBeforeUnload().defaultPrevented).toBe(true);
    rerender(<Editor dirty={false} />);
    expect(fireBeforeUnload().defaultPrevented).toBe(false);
    expect(confirmLeaveResult()).toBe('true');
  });

  it('an unmounted dirty editor no longer blocks navigation', () => {
    const { unmount } = render(<Editor dirty />);
    unmount();
    render(
      <GuardedLink href="/ready" data-testid="other">
        Other
      </GuardedLink>,
    );
    fireEvent.click(screen.getByTestId('other'));
    expect(screen.queryByText('Leave without saving?')).toBeNull();
  });
});
