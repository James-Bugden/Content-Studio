/**
 * Shared button classes (CS-006). Blue (the one primary accent) is reserved for
 * the one main action in a group; everything else is a quiet outline so the next
 * action stays obvious. Green is kept only for a button that literally approves
 * or confirms something as done, so it stays a confirmed/approved signal and never
 * a general "important" colour. Minimum 44 px tall for touch targets at phone width.
 *
 * The lift/press craft is the Polished control treatment from the approved Calm
 * Signal wireframe (styles-opt1.css lines 92-94, 98): a hairline resting shadow,
 * a soft lift on hover, a press on active. Movement is gated on motion-safe.
 */
export type ButtonVariant = 'primary' | 'approve' | 'secondary' | 'danger';

/** Resting shadow, hover lift and press for any button-shaped control. */
export const buttonCraft =
  'shadow-[0_1px_1px_rgba(23,32,35,.04)] transition-[box-shadow,translate,scale,background-color,border-color] duration-150 ease-out hover:shadow-[0_2px_6px_rgba(23,32,35,.1)] motion-safe:hover:-translate-y-px active:shadow-none motion-safe:active:translate-y-0 motion-safe:active:scale-[.98]';

export type ButtonSize = 'md' | 'sm';

const base = `inline-flex items-center justify-center gap-2 rounded-md font-medium text-center disabled:cursor-not-allowed disabled:opacity-50 ${buttonCraft}`;

/** `md` is the default 44 px control; `sm` is for in-row actions inside a dense table. */
const sizes: Record<ButtonSize, string> = {
  md: 'min-h-11 px-4 py-2 text-sm',
  sm: 'min-h-8 px-2.5 py-1 text-xs',
};

const variants: Record<ButtonVariant, string> = {
  // The one accent action. The gradient only lightens the top edge (wireframe line 98).
  primary: 'bg-primary bg-linear-to-b from-white/10 to-transparent text-white shadow-[0_1px_2px_rgba(29,78,216,.2)] hover:bg-primary/90',
  // Approve / confirm-as-done only: the same green as a ✓ or an "Approved" state.
  approve: 'bg-green bg-linear-to-b from-white/10 to-transparent text-white shadow-[0_1px_2px_rgba(10,61,38,.15)] hover:bg-green/90',
  secondary: 'border border-line bg-card text-ink hover:bg-paper',
  danger: 'border border-block bg-card text-block hover:bg-block-soft',
};

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md'): string {
  return `${base} ${sizes[size]} ${variants[variant]}`;
}
