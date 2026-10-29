// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { classifyShortcut, enabledButton, listPostIds, neighbour } from '@/components/panel/shortcuts';
import { ShortcutsHelp } from '@/components/shortcuts-help';

afterEach(cleanup);
const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

describe('panel shortcuts (#247)', () => {
  it('classifies the approve chord apart from save and next', () => {
    expect(classifyShortcut(key('Enter', { ctrlKey: true, shiftKey: true }), true)).toBe('approve-and-queue');
    expect(classifyShortcut(key('Enter', { metaKey: true, shiftKey: true }), false)).toBe('approve-and-queue');
    expect(classifyShortcut(key('Enter', { ctrlKey: true }), true)).toBe('save-and-next');
    expect(classifyShortcut(key('Enter', { ctrlKey: true, altKey: true }), true)).toBeNull();
    expect(classifyShortcut(key('Enter', { shiftKey: true }), false)).toBeNull();
  });

  it('keeps the existing shortcuts', () => {
    expect(classifyShortcut(key('s', { ctrlKey: true }), true)).toBe('save-draft');
    expect(classifyShortcut(key('ArrowDown', { altKey: true }), true)).toBe('next');
    expect(classifyShortcut(key('ArrowUp', { altKey: true }), true)).toBe('previous');
    expect(classifyShortcut(key('j'), false)).toBe('next');
    expect(classifyShortcut(key('K'), false)).toBe('previous');
    expect(classifyShortcut(key('j'), true)).toBeNull();
    expect(classifyShortcut(key('ArrowDown'), true)).toBeNull();
  });

  it('only presses a button that exists and is enabled', () => {
    document.body.innerHTML = '<div id="r"><button data-shortcut="approve-and-queue" disabled>Approve</button><button data-shortcut="save-draft" aria-disabled="true">Save</button><button data-shortcut="other">Other</button></div>';
    const root = document.getElementById('r')!;
    expect(enabledButton(root, 'button[data-shortcut="approve-and-queue"]')).toBeNull();
    expect(enabledButton(root, 'button[data-shortcut="save-draft"]')).toBeNull();
    expect(enabledButton(root, 'button[data-shortcut="missing"]')).toBeNull();
    expect(enabledButton(root, 'button[data-shortcut="other"]')).not.toBeNull();
  });

  it('finds neighbours from the post links in page order', () => {
    document.body.innerHTML = '<main><a aria-haspopup="dialog" href="/review?post=SYN-L001">a</a><a aria-haspopup="dialog" href="/review?post=SYN-L002">b</a><a aria-haspopup="dialog" href="/review?post=SYN-L001">dup</a><a href="/x?post=SYN-L009">no</a></main>';
    const ids = listPostIds();
    expect(ids).toEqual(['SYN-L001', 'SYN-L002']);
    expect(neighbour(ids, 'SYN-L001', 1)).toBe('SYN-L002');
    expect(neighbour(ids, 'SYN-L001', -1)).toBeNull();
    expect(neighbour(ids, 'SYN-L404', 1)).toBeNull();
  });
});

describe('ShortcutsHelp (#247)', () => {
  it('has a ? button with aria-keyshortcuts that opens the list; Escape closes', async () => {
    render(<ShortcutsHelp />);
    const button = screen.getByRole('button', { name: 'Keyboard shortcuts' });
    expect(button.getAttribute('aria-keyshortcuts')).toBe('?');
    await act(async () => { fireEvent.click(button); });
    expect(screen.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeTruthy();
    expect(screen.getByText('Ctrl/Cmd + Shift + Enter')).toBeTruthy();
    await act(async () => { fireEvent.keyDown(document.querySelector('dialog')!, { key: 'Escape' }); });
    expect(screen.queryByRole('heading', { name: 'Keyboard shortcuts' })).toBeNull();
  });

  it('opens on ? only when not typing', async () => {
    render(<><input aria-label="field" /><ShortcutsHelp /></>);
    await act(async () => { fireEvent.keyDown(screen.getByLabelText('field'), { key: '?' }); });
    expect(screen.queryByRole('heading', { name: 'Keyboard shortcuts' })).toBeNull();
    await act(async () => { fireEvent.keyDown(document.body, { key: '?' }); });
    expect(screen.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeTruthy();
  });
});
