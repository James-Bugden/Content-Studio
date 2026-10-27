/** Small original stroke icons used by the application frame. */
export function ShellIcon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    '/': <path d="m3 11 9-8 9 8M5 10v11h5v-7h4v7h5V10" />,
    '/review': <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
    '/schedule': <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18M7 14h3M14 14h3" /></>,
    '/backlog': <path d="m3 7 9-4 9 4-9 4-9-4Zm0 5 9 4 9-4M3 17l9 4 9-4" />,
    '/published': <><circle cx="12" cy="12" r="9" /><path d="m7 12 3 3 7-7" /></>,
    '/reconcile': <><path d="m12 3 10 18H2L12 3ZM12 9v5M12 17h.01" /></>,
    '/replies': <path d="M21 12a9 9 0 0 1-9 9H3l2-5a9 9 0 1 1 16-4ZM8 10h8M8 14h5" />,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    collapse: <path d="m14 6-6 6 6 6" />,
    search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
