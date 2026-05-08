import type { Metadata, Viewport } from 'next';
import { Fraunces, Bricolage_Grotesque, JetBrains_Mono } from 'next/font/google';
import './globals.css';

// Self-host fonts via next/font — eliminates render-blocking CSS @import,
// preloads on first paint, prevents FOUT.
const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-display',
  weight: ['300', '400', '500', '600', '700'],
});

const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-body',
  weight: ['400', '500', '600', '700'],
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
  weight: ['400', '500', '700'],
});

export const metadata: Metadata = {
  title: 'Workout Tracker',
  description: 'Track sets, reps, and muscle group coverage. Self-hosted.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Workout',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/icon-180.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#16110d',
  width: 'device-width',
  initialScale: 1,
  // Prevent zoom on input focus — handy on mobile when logging numbers
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`bg-ink-950 ${fraunces.variable} ${bricolage.variable} ${jetbrains.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
