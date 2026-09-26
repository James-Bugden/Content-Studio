import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button, Pill } from '@/replies/components/replies/primitives';
import { SourceInput } from '@/replies/components/replies/SourceInput';

describe('visual theme (THEME-01)', () => {
  it('uses black as the general UI accent and removes the former blue primary', () => {
    const css = readFileSync('src/app/globals.css', 'utf8');
    expect(css).toContain('--color-primary: #000000;');
    expect(css).not.toContain('#1d4ed8');
    expect(css).toContain('--color-paper: #f6f6f6;');
    expect(css).toContain('--color-card: #ffffff;');
  });
});

describe('integrated Replies theme (THEME-01/02)', () => {
  it('uses black for primary actions and keeps green only for a labelled success state', () => {
    const action = renderToStaticMarkup(createElement(Button, { variant: 'primary' }, 'Get reply ideas'));
    expect(action).toContain('bg-primary text-white hover:bg-primary/85');
    expect(action).not.toContain('bg-green');
    expect(action).not.toContain('green-hover');

    const success = renderToStaticMarkup(Pill({ tone: 'green', children: 'Saved' }));
    expect(success).toContain('bg-green-soft text-green');
    expect(success).toContain('Saved');
  });

  it('uses monochrome selected controls with checked/pressed semantics', () => {
    const html = renderToStaticMarkup(createElement(SourceInput, {
      platform: 'linkedin', targetKind: 'post', sourceText: '', parentText: '', sourceUrl: '',
      busy: false, collapsed: false,
      onPlatformChange() {}, onTargetKindChange() {}, onFieldChange() {}, onSubmit() {}, onExpandToggle() {},
    }));
    expect(html).toMatch(/aria-checked="true"[^>]*border-primary bg-primary font-medium text-white/);
    expect(html).toMatch(/aria-pressed="true"[^>]*border-primary bg-primary font-medium text-white/);
    expect(html).not.toContain('border-green');
    expect(html).not.toContain('bg-green-soft');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('aria-pressed="false"');
  });
});
