import { Inter, JetBrains_Mono } from 'next/font/google';
import '../styles/globals.css';
import { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { Toaster } from '@/components/ui/toaster';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { VersionedSearchDialog } from '@/components/docs/versioned-search-dialog';
import { SITE_ORIGIN } from '@/constants/site';

// Inter for everything (the brand face), JetBrains Mono for code.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains-mono' });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: 'Tenantry — Multi-tenancy for .NET',
  description:
    'Tenantry brings multi-tenancy to your .NET application. Open-source Tenantry Core resolves tenants and isolates their data in EF Core, in a shared database or a database per tenant. Tenantry Pro adds provisioning, migrations across tenant databases, schema per tenant, and the tenant in background jobs and messages.',
};

export const viewport: Viewport = {
  themeColor: '#0b1120',
  colorScheme: 'dark',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    // The site is dark only: the theme provider forces the dark class before the page paints.
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <body className={'min-h-screen font-sans'}>
        {/* Fumadocs' provider (search, theme) for the whole site, so the docs share the forced dark theme. */}
        <RootProvider
          theme={{ forcedTheme: 'dark', defaultTheme: 'dark', enableSystem: false }}
          search={{ SearchDialog: VersionedSearchDialog }}
        >
          {children}
          <Toaster />
        </RootProvider>
        {/* Cookieless page views and real-user Core Web Vitals; both report only when deployed on Vercel. */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
