import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { RootProvider } from 'fumadocs-ui/provider/next';
import type { ReactNode } from 'react';
import { source } from '@/lib/source';

export default function DocsRootLayout({ children }: { children: ReactNode }) {
  return (
    // theme.enabled=false: the marketing site forces a single dark theme via <html class="dark">,
    // so we don't let Fumadocs' next-themes provider also manage it.
    <RootProvider theme={{ enabled: false }}>
      <DocsLayout
        tree={source.getPageTree()}
        nav={{ title: 'Tenantry docs' }}
        githubUrl="https://github.com/tenantry-org/tenantry-core"
      >
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
