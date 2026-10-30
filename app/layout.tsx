import './globals.css';
import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans, IBM_Plex_Mono, Space_Grotesk } from 'next/font/google';
import ThemeBoot from '../components/ThemeBoot';
import { BRAND } from '../lib/brand';
import { themeById } from '../lib/themes';

const sans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-sans' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono' });
// jam's headlines and name have their own voice
const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '700'], variable: '--font-display' });

export const metadata: Metadata = {
  title: BRAND.title,
  description: BRAND.description,
  metadataBase: new URL('http://localhost:3000'),
  icons: [{ rel: 'icon', url: BRAND.icon, type: 'image/svg+xml' }],
};

export const viewport: Viewport = {
  themeColor: themeById(BRAND.theme).vars['--bg'],
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-brand={BRAND.id} className={`${sans.variable} ${mono.variable} ${display.variable}`}>
      <body>
        <ThemeBoot />
        {children}
      </body>
    </html>
  );
}
