import type { ReactNode, ButtonHTMLAttributes, Ref } from 'react';

/**
 * The small set of shapes every section reuses (D02, D13).
 *
 * Two rules are enforced here rather than left to each component:
 *
 *   * a card containing selectable text does not move on hover. The owner is
 *     dragging across Chinese to copy part of a reply; a card that lifts under the
 *     cursor breaks the selection;
 *   * a primary control is 44 px and a utility control is at least 32 px with
 *     spacing. These are product choices stated in D13, alongside WCAG, not a claim
 *     that AA requires 44 px everywhere.
 */

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function Card({
  children,
  className,
  as: Element = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'li' | 'article';
}) {
  return (
    <Element
      className={cx(
        'rounded-lg border border-hairline bg-card p-3',
        // No transform, no shadow change: text selection stays still.
        className,
      )}
    >
      {children}
    </Element>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet';
  size?: 'primary' | 'utility';
  /** Needed so a dialog can return focus to the control that opened it (D13). */
  ref?: Ref<HTMLButtonElement>;
};

export function Button({
  variant = 'secondary',
  size = 'utility',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        'inline-flex items-center justify-center rounded-md px-3 font-medium',
        'disabled:cursor-not-allowed disabled:opacity-50',
        size === 'primary' ? 'min-h-11 text-[0.9375rem]' : 'min-h-8 text-meta',
        variant === 'primary' && 'bg-green text-paper hover:bg-green-hover',
        variant === 'secondary' && 'border border-border-input bg-card text-ink hover:bg-paper-alt',
        variant === 'quiet' && 'text-ink-soft hover:text-ink hover:bg-paper-alt',
        className,
      )}
    />
  );
}

export function SectionHeading({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="mb-2 text-[0.9375rem] font-semibold text-ink">
      {children}
    </h2>
  );
}

export function Meta({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('text-meta text-ink-soft', className)}>{children}</p>;
}

/**
 * Reply text, shown the way it will look once posted.
 *
 * Every read-only view of a reply used a plain paragraph, and HTML collapses line
 * breaks, so a three-paragraph idea displayed as one run-on block while the editor
 * showed the same text with its breaks. The preview disagreed with what would be
 * posted, which is the one thing a preview must not do.
 *
 * `pre-wrap` keeps line breaks and blank lines exactly as written; long unbroken
 * runs such as a link wrap instead of pushing the card wider than a phone.
 * Chinese gets its looser line height and a language tag for screen readers.
 */
export function ReplyText({
  text,
  chinese = false,
  className,
}: {
  text: string;
  chinese?: boolean;
  className?: string;
}) {
  return (
    <p
      className={cx('whitespace-pre-wrap [overflow-wrap:anywhere] text-reply', chinese && 'sr-cjk', className)}
      {...(chinese ? { lang: 'zh-TW' } : {})}
    >
      {text}
    </p>
  );
}

/**
 * A status line that assistive technology announces once, politely.
 *
 * Polite and not assertive because these announcements arrive while the owner is
 * typing, and interrupting them mid-sentence to say "three ideas are ready" is
 * exactly the behaviour D13 rules out.
 */
export function StatusLine({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'error' }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className={cx('text-meta', tone === 'error' ? 'text-danger' : 'text-ink-soft')}
    >
      {children}
    </p>
  );
}

/** A label that is not colour alone: every state also has words (D13). */
export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'green' }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-meta',
        tone === 'green' ? 'bg-green-soft text-green' : 'bg-paper-alt text-ink-soft',
      )}
    >
      {children}
    </span>
  );
}

