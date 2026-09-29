'use client';

import DefaultSearchDialog from 'fumadocs-ui/components/dialog/search-default';
import type { SharedProps } from 'fumadocs-ui/components/dialog/search';
import { usePathname } from 'next/navigation';
import { docsVersionOfPath, docsVersions } from '@/lib/docs-versions';

const tags = docsVersions.map((entry) => ({
  name: entry.latest ? `v${entry.version} (latest)` : `v${entry.version}`,
  value: entry.version,
}));

// Search within the docs version being read (the latest outside the docs); with more than one version, the footer
// switches between them.
export function VersionedSearchDialog(props: SharedProps) {
  const version = docsVersionOfPath(usePathname());
  return <DefaultSearchDialog {...props} defaultTag={version.version} tags={tags.length > 1 ? tags : []} />;
}
