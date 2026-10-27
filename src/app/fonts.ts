import { Nunito_Sans } from 'next/font/google';

/** Nunito Sans is downloaded at build time and self-hosted by Next.js.
 * The existing CSS variable and system/CJK fallback stacks stay compatible. */
export const nunitoSans = Nunito_Sans({
  subsets: ['latin'],
  variable: '--font-sans-polished',
  display: 'swap',
  preload: false,
});
