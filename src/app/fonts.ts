import localFont from 'next/font/local';

/**
 * App type (CS-042, Linear-style direction approved 2026-10-03): one sans face
 * for everything, headings included.
 *
 * Vendored Latin WOFF2 files keep builds independent of Google Fonts and are
 * served as same-origin static assets, satisfying the existing font CSP.
 * The CSS variable is folded into the Tailwind
 * `--font-sans` token in globals.css, with the system stack as the fallback.
 */
export const inter = localFont({
  src: [
    { path: './fonts/inter-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/inter-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/inter-latin-600-normal.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-sans-polished',
  display: 'swap',
});
