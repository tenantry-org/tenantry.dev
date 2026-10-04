import { source } from '@/lib/source';
import { DocsBody, DocsPage, DocsTitle } from 'fumadocs-ui/page';
import { Callout } from 'fumadocs-ui/components/callout';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getMDXComponents } from '@/mdx-components';
import { docsVersionOf, latestDocsVersion, slugsInVersion, slugsOutsidePublishedVersions } from '@/lib/docs-versions';

// The same page in the latest docs, or the latest docs' home when the page is gone.
function latestUrl(slugs: string[]): string {
  return source.getPage(slugsInVersion(slugs, latestDocsVersion))?.url ?? latestDocsVersion.base;
}

// The page at these slugs. A path under a docs version the site does not publish redirects to the same page in the
// latest docs, or to the latest docs' home when the page is not there; any other missing page is not found.
function pageAt(slugs: string[] = []) {
  const page = source.getPage(slugs);
  if (page) return page;

  const latestSlugs = slugsOutsidePublishedVersions(slugs);
  if (latestSlugs) redirect(latestUrl(latestSlugs));
  notFound();
}

export default async function Page(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;
  const page = pageAt(params.slug);

  const MDX = page.data.body;
  const version = docsVersionOf(page.slugs);

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      {!version.latest && (
        <Callout type={'warn'} title={`These are the docs for version ${version.version}`}>
          The latest release is {latestDocsVersion.version}.{' '}
          <Link href={latestUrl(page.slugs)}>Read this page in the latest docs</Link>.
        </Callout>
      )}
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;
  const page = pageAt(params.slug);

  const version = docsVersionOf(page.slugs);

  return {
    title: `${page.data.title}${version.latest ? '' : ` (v${version.version})`} | Tenantry docs`,
    description: page.data.description,
    // Search engines should send readers to the latest docs, not an older version's copy of the page.
    alternates: version.latest ? undefined : { canonical: latestUrl(page.slugs) },
  };
}
