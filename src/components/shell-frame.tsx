'use client';

import { useEffect, useRef, useState } from 'react';
import { ShellIcon } from './shell-icon';
import { ShellStatusProvider } from './shell-status';
import { ShortcutsHelp } from './shortcuts-help';

export function ShellFrame({ children, navigation, accountSlot, statusSlot }: {
  children: React.ReactNode; navigation: React.ReactNode; accountSlot?: React.ReactNode; statusSlot?: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const account = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (account.current && !account.current.contains(event.target as Node)) account.current.open = false;
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  return <div className="studio-shell" data-collapsed={collapsed}>
    <aside className="studio-rail" aria-label="Studio navigation">
      <div className="studio-brand" title="Content Studio"><span aria-hidden="true">CS</span><span className="sr-only">Content Studio</span></div>
      {navigation}
      <button type="button" className="studio-collapse" aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
        <ShellIcon name="collapse" /><span className="studio-nav-label">Collapse</span>
      </button>
    </aside>
    <div className="studio-workspace">
      <header className="studio-topbar">
        <div className="studio-search" aria-hidden="true" />
        <button type="button" className="studio-new-post" disabled title="New post creation is not available yet"><ShellIcon name="plus" /><span>New post</span></button>
        <ShortcutsHelp />
        <button type="button" className="studio-icon-button" aria-label="Notifications" disabled title="Notifications are not available yet"><ShellIcon name="bell" /></button>
        <details ref={account} className="studio-account" onKeyDown={event => {
          if (event.key === 'Escape' && account.current?.open) {
            account.current.open = false;
            account.current.querySelector('summary')?.focus();
          }
        }}>
          <summary aria-label="Account menu" className="studio-avatar"><span aria-hidden="true">CS</span></summary>
          <div className="studio-account-panel"><p className="mb-3 font-semibold">Content Studio</p>{accountSlot ?? <p className="text-ink-soft">Account controls unavailable</p>}</div>
        </details>
      </header>
      <ShellStatusProvider fallback={statusSlot}>
        <main id="main" tabIndex={-1} className="studio-main">{children}</main>
      </ShellStatusProvider>
    </div>
  </div>;
}
