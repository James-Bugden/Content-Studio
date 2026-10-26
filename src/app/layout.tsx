import type { Metadata, Viewport } from 'next';
import { nunitoSans } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: 'Content Studio',
  description: 'Owner-only control surface over the content Sheet, Drive and Typefully.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // The font variable lives on <html> so the @theme tokens that reference them
  // resolve at :root (a custom property that points at an undefined variable
  // becomes invalid where it is declared, not where it is used).
  return (
    <html lang="en-GB" className={nunitoSans.variable}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
