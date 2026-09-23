/**
 * Shared button classes (CS-006). Green is reserved for the one primary action in
 * a group; everything else is a quiet outline so the next action stays obvious.
 * Minimum 44 px tall for touch targets at phone width.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'danger';

const base =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-center disabled:cursor-not-allowed disabled:opacity-50';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-green text-white hover:bg-green/90',
  secondary: 'border border-line bg-card text-ink hover:bg-paper',
  danger: 'border border-block bg-card text-block hover:bg-block-soft',
};

export function buttonClass(variant: ButtonVariant = 'secondary'): string {
  return `${base} ${variants[variant]}`;
}
