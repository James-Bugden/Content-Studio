/**
 * Link to a source document (CS-006, SEC-10).
 *
 * Private Drive and Sheet URLs are never printed as text: only the label shows,
 * so screenshots and screen shares do not leak paths. Opens in a new tab without
 * an opener reference or referrer. Anything that is not http(s) is rendered as
 * plain text rather than a link, so a hostile cell cannot become a javascript: URL.
 */
export function isSafeHref(href: string): boolean {
  try {
    const url = new URL(href);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function SourceLink({ href, label }: { href: string; label: string }) {
  if (!isSafeHref(href)) {
    return (
      <span className="[overflow-wrap:anywhere] text-ink-soft">
        {label} <span className="text-sm">(link unavailable)</span>
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="[overflow-wrap:anywhere] text-info underline decoration-1 underline-offset-2 hover:decoration-2"
    >
      {label}
      <span aria-hidden="true"> {'↗'}</span>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
