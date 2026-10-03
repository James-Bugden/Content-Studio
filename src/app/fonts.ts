import { Inter } from 'next/font/google';

/**
 * App type (CS-042, Linear-style direction approved 2026-10-03): one sans face
 * for everything, headings included.
 *
 * next/font self-hosts the family into the app's own static assets at build
 * time, so it satisfies the strict `font-src 'self'` CSP with no runtime request
 * to Google and no CSP change. The CSS variable is folded into the Tailwind
 * `--font-sans` token in globals.css, with the system stack as the fallback.
 */
export const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans-polished',
  display: 'swap',
});
