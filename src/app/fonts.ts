import { IBM_Plex_Sans, Source_Serif_4 } from 'next/font/google';

/**
 * Polished type pair from the approved Calm Signal wireframe
 * (wireframe/2409-app-redesign-backlog/styles-opt1.css, lines 70-73).
 *
 * next/font self-hosts both families into the app's own static assets at
 * build time, so they satisfy the strict `font-src 'self'` CSP with no
 * runtime request to Google and no CSP change. Each exposes a CSS variable
 * that globals.css folds into the Tailwind `--font-sans` / `--font-serif`
 * tokens with the system stack as the fallback.
 */
export const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-sans-polished',
  display: 'swap',
});

export const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  weight: ['600'],
  variable: '--font-serif-polished',
  display: 'swap',
});
