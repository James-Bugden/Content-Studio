// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ERROR_CATALOGUE, ERROR_CODES } from '@/domain/errors';
import { ErrorState, STATE_KINDS, STATE_LOOK, StateView } from '@/components/state-view';
import { CapabilityBanner } from '@/components/capability-banner';
import { InlineResult } from '@/components/inline-result';
import { SourceLink } from '@/components/source-link';

afterEach(cleanup);

const POLITE = new Set(['loading', 'empty', 'no_match']);

describe('StateView (UX-02)', () => {
  it.each(STATE_KINDS)('%s has the right live role and default copy', (kind) => {
    const { container } = render(<StateView kind={kind} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('role')).toBe(POLITE.has(kind) ? 'status' : 'alert');
    expect(root.getAttribute('data-state')).toBe(kind);
    expect(screen.getByText(STATE_LOOK[kind].title)).toBeTruthy();
    expect(screen.getByText(STATE_LOOK[kind].label)).toBeTruthy();
  });

  it('marks loading as busy', () => {
    const { container } = render(<StateView kind="loading" />);
    expect(container.firstElementChild?.getAttribute('aria-busy')).toBe('true');
  });

  it('gives every kind a distinct visible label and frame', () => {
    const labels = STATE_KINDS.map((k) => STATE_LOOK[k].label);
    const titles = STATE_KINDS.map((k) => STATE_LOOK[k].title);
    const frames = STATE_KINDS.map((k) => `${STATE_LOOK[k].frame}|${STATE_LOOK[k].glyph}`);
    expect(new Set(labels).size).toBe(STATE_KINDS.length);
    expect(new Set(titles).size).toBe(STATE_KINDS.length);
    expect(new Set(frames).size).toBe(STATE_KINDS.length);
  });

  it('every problem state names a next step', () => {
    for (const kind of STATE_KINDS.filter((k) => !POLITE.has(k))) {
      expect(STATE_LOOK[kind].nextStep, kind).toBeTruthy();
    }
  });
});

describe('ErrorState', () => {
  it.each(ERROR_CODES)('%s shows the catalogue message, which says what is safe', (code) => {
    render(<ErrorState code={code} />);
    expect(screen.getByText(ERROR_CATALOGUE[code].message)).toBeTruthy();
  });
});

describe('CapabilityBanner', () => {
  it('lists only providers that are not ready, with the consequence in words', () => {
    render(
      <CapabilityBanner
        capabilities={[
          { provider: 'sheet', state: 'ready', mode: 'fake' },
          { provider: 'typefully', state: 'not_configured', mode: 'live' },
        ]}
      />,
    );
    expect(screen.getByText(/Typefully not configured: publishing actions are disabled; review still works/)).toBeTruthy();
    expect(screen.queryByText(/Google Sheet/)).toBeNull();
  });

  it('renders nothing when every provider is ready', () => {
    const { container } = render(<CapabilityBanner capabilities={[{ provider: 'sheet', state: 'ready', mode: 'fake' }]} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('InlineResult', () => {
  it('announces errors assertively and others politely, with a visible word', () => {
    render(
      <>
        <InlineResult tone="error">Save failed.</InlineResult>
        <InlineResult tone="success">Saved.</InlineResult>
      </>,
    );
    expect(screen.getByRole('alert').textContent).toContain('Error:');
    expect(screen.getByRole('status').textContent).toContain('Done:');
  });
});

describe('SourceLink (SEC-10)', () => {
  it('shows only the label, opens safely in a new tab', () => {
    const href = 'https://example.invalid/private/folder/synthetic';
    render(<SourceLink href={href} label="Source Markdown" />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.textContent).not.toContain('example.invalid');
    expect(link.textContent).toContain('Source Markdown');
  });

  it('never renders a javascript: URL as a link', () => {
    render(<SourceLink href="javascript:alert(1)" label="Hostile" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(/Hostile/)).toBeTruthy();
  });
});
