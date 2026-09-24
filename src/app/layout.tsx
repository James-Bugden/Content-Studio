import type { Metadata } from 'next';
import { plexSans, sourceSerif } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: 'Content Studio',
  description: 'Owner-only control surface over the content Sheet, Drive and Typefully.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Font variables live on <html> so the @theme tokens that reference them
  // resolve at :root (a custom property that points at an undefined variable
  // becomes invalid where it is declared, not where it is used).
  return (
    <html lang="en-GB" className={`${plexSans.variable} ${sourceSerif.variable}`}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
