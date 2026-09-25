// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useRef } from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormatToolbar } from '@/replies/components/replies/FormatToolbar';
import { toBold } from '@/replies/lib/text/format';
import type { Platform } from '@/replies/lib/contracts/vocabulary';

/**
 * The toolbar works on the owner's own selection and goes through the editor's
 * ordinary onChange, so every change is subject to the same version checks and
 * recovery as a keystroke.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Harness({
  text,
  platform = 'linkedin',
  onChange,
  select,
}: {
  text: string;
  platform?: Platform;
  onChange(next: string): void;
  select?: [number, number];
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <>
      <FormatToolbar textarea={ref} text={text} platform={platform} onChange={onChange} />
      <textarea
        aria-label="Your reply"
        ref={(el) => {
          ref.current = el;
          if (el && select) el.setSelectionRange(select[0], select[1]);
        }}
        defaultValue={text}
      />
    </>
  );
}

describe('the formatting toolbar', () => {
  it('bolds exactly the selected words, with letters the platforms display', async () => {
    const onChange = vi.fn();
    render(<Harness text="Ask for the range first" select={[8, 17]} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: 'Bold' }));

    expect(onChange).toHaveBeenCalledWith(`Ask for ${toBold('the range')} first`);
    // Never markdown.
    expect(onChange.mock.calls[0]![0]).not.toContain('*');
  });

  it('turns lines into bullets', async () => {
    const onChange = vi.fn();
    render(<Harness text={'their budget\nyour value'} select={[0, 23]} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: 'Bulleted list' }));

    expect(onChange).toHaveBeenCalledWith('• their budget\n• your value');
  });

  it('offers to clean pasted markdown, and only changes it when asked', async () => {
    const onChange = vi.fn();
    render(<Harness text="**Always** ask" onChange={onChange} />);

    expect(screen.getByRole('status').textContent).toContain('LinkedIn will show those symbols as typed');
    expect(onChange).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Clean up markdown' }));
    expect(onChange).toHaveBeenCalledWith(`${toBold('Always')} ask`);
  });

  it('says nothing about plain text', () => {
    render(<Harness text="Plain reply, nothing to fix." onChange={vi.fn()} />);
    expect(screen.queryByRole('status')).toBeNull();
    // Nor the screen-reader note, which is about styled letters that are not there.
    expect(screen.queryByText(/Screen readers may spell them out/)).toBeNull();
  });

  it('explains the screen-reader cost once styled letters are present', () => {
    render(<Harness text={`Ask for ${toBold('the range')}`} onChange={vi.fn()} />);
    expect(screen.getByText(/Screen readers may spell them out/)).toBeTruthy();
  });

  it('counts against the reply limit for the platform, and says when it is over', () => {
    render(<Harness text={'a'.repeat(501)} platform="threads" onChange={vi.fn()} />);
    expect(screen.getByText(/501 \/ 500 characters · Over the Threads limit/)).toBeTruthy();
  });

  it('does not flag a LinkedIn comment at Threads length', () => {
    render(<Harness text={'a'.repeat(501)} platform="linkedin" onChange={vi.fn()} />);
    expect(screen.getByText('501 / 1,250 characters')).toBeTruthy();
  });
});

