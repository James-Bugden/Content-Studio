import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Content Studio',
  description: 'Owner-only control surface over the content Sheet, Drive and Typefully.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
