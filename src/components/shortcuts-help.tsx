'use client';

import { useEffect, useRef, useState } from 'react';
import { isTypingTarget } from './keyboard';
import { ModalDialog } from './modal-dialog';
import { SHORTCUT_HELP } from './panel/shortcuts';
import { buttonClass } from './button-styles';

/**
 * The `?` button and key (#247). Opens a small dialog listing the keyboard
 * shortcuts. The native dialog supplies the focus trap and Escape; the button is
 * hidden on touch devices, where there is no keyboard to learn.
 */
export function ShortcutsHelp() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.key !== '?' && !(event.key === '/' && event.shiftKey)) || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <>
      <button ref={trigger} type="button" className="studio-icon-button [@media(pointer:coarse)]:hidden" aria-label="Keyboard shortcuts" aria-keyshortcuts="?" aria-haspopup="dialog" title="Keyboard shortcuts (?)" onClick={() => setOpen(true)}>
        <span aria-hidden="true" className="font-semibold">?</span>
      </button>
      <ModalDialog open={open} onClose={() => setOpen(false)} title="Keyboard shortcuts" returnFocusTo={trigger}
        footer={<button type="button" className={buttonClass()} onClick={() => setOpen(false)}>Close</button>}>
        <div className="flex flex-col gap-4 text-sm">
          {SHORTCUT_HELP.map((g) => (
            <section key={g.group} aria-label={g.group}>
              <h3 className="mb-1 font-semibold">{g.group}</h3>
              <dl className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)] gap-x-3 gap-y-1">
                {g.items.map((i) => (<div key={i.keys} className="contents"><dt><kbd className="rounded border border-line bg-paper px-1.5 py-0.5 font-mono text-xs">{i.keys}</kbd></dt><dd>{i.what}</dd></div>))}
              </dl>
            </section>
          ))}
        </div>
      </ModalDialog>
    </>
  );
}
