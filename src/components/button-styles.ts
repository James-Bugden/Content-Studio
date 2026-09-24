/**
 * Shared button classes (CS-006). Green is reserved for the one primary action in
 * a group; everything else is a quiet outline so the next action stays obvious.
 * Minimum 44 px tall for touch targets at phone width.
 *
 * The lift/press craft is the Polished control treatment from the approved Calm
 * Signal wireframe (styles-opt1.css lines 92-94, 98): a hairline resting shadow,
 * a soft lift on hover, a press on active. Movement is gated on motion-safe.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'danger';

/** Resting shadow, hover lift and press for any button-shaped control. */
export const buttonCraft =
  'shadow-[0_1px_1px_rgba(23,32,35,.04)] transition-[box-shadow,translate,scale,background-color,border-color] duration-150 ease-out hover:shadow-[0_2px_6px_rgba(23,32,35,.1)] motion-safe:hover:-translate-y-px active:shadow-none motion-safe:active:translate-y-0 motion-safe:active:scale-[.98]';

const base = `inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-center disabled:cursor-not-allowed disabled:opacity-50 ${buttonCraft}`;

const variants: Record<ButtonVariant, string> = {
  // Green stays the identity; the gradient only lightens the top edge (wireframe line 98 in green).
  primary: 'bg-green bg-linear-to-b from-white/10 to-transparent text-white shadow-[0_1px_2px_rgba(10,61,38,.15)] hover:bg-green/90',
  secondary: 'border border-line bg-card text-ink hover:bg-paper',
  danger: 'border border-block bg-card text-block hover:bg-block-soft',
};

export function buttonClass(variant: ButtonVariant = 'secondary'): string {
  return `${base} ${variants[variant]}`;
}
