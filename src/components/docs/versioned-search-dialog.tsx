'use client';

import DefaultSearchDialog from 'fumadocs-ui/components/dialog/search-default';
import type { SharedProps } from 'fumadocs-ui/components/dialog/search';
import { usePathname } from 'next/navigation';
import { docsVersionOfPath } from '@/lib/docs-versions';

// Search within the docs version being read (the latest outside the docs). The sidebar's version dropdown switches
// versions; passing the versions as tags too would render Fumadocs' tag list as a bar at the top of every page.
export function VersionedSearchDialog(props: SharedProps) {
  const version = docsVersionOfPath(usePathname());
  return <DefaultSearchDialog {...props} defaultTag={version.version} />;
}
