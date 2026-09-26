import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button, Pill } from '@/replies/components/replies/primitives';

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
});
