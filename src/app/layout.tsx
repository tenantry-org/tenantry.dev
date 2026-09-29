import { Inter } from 'next/font/google';
import '../styles/globals.css';
import '../styles/layout.css';
import { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Toaster } from '@/components/ui/toaster';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL('https://tenantry.dev'),
  title: 'Tenantry — Multi-tenancy for .NET',
  description:
    'Tenantry is a production-grade multi-tenancy toolkit for .NET. Core is open source and isolates tenants in a shared database or a database per tenant. Pro adds schema-per-tenant and mixed mode, provisioning, migration orchestration across tenant databases, tenant lifecycle management, and background-job and messaging integrations.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" className={'min-h-full dark'}>
      <body className={inter.className}>
        {children}
        <Toaster />
        {/* Cookieless page views and real-user Core Web Vitals; both report only when deployed on Vercel. */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
