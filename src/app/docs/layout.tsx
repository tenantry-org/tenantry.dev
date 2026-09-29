import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';
import { source } from '@/lib/source';
import { Logo } from '@/components/brand/logo';

// The theme and search providers come from the root layout, shared with the rest of the site.
export default function DocsRootLayout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      nav={{
        title: (
          <span className={'flex items-center gap-2'}>
            <Logo className={'h-6'} />
            <span className={'text-sm font-medium text-muted-foreground'}>Docs</span>
          </span>
        ),
      }}
      githubUrl="https://github.com/tenantry-org/tenantry-core"
    >
      {children}
    </DocsLayout>
  );
}
