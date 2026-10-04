import type { Metadata } from 'next';
import { HomePage } from '@/components/home/home-page';
import { latestDocsVersion } from '@/lib/docs-versions';
import { SITE_ORIGIN } from '@/constants/site';

// The title and description are the root layout's.
export const metadata: Metadata = { alternates: { canonical: '/' } };

// Tenantry Core as schema.org source code: the open-source library, at the release the docs are of.
const CORE_SOURCE = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareSourceCode',
  name: 'Tenantry Core',
  description: 'Tenant isolation for ASP.NET Core and EF Core applications.',
  url: SITE_ORIGIN,
  codeRepository: 'https://github.com/tenantry-org/tenantry-core',
  programmingLanguage: 'C#',
  runtimePlatform: '.NET',
  license: 'https://www.apache.org/licenses/LICENSE-2.0',
  version: latestDocsVersion.core.slice(1),
};

export default function Home() {
  return (
    <>
      <script
        type={'application/ld+json'}
        // JSON from constants: nothing a reader supplies.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(CORE_SOURCE).replaceAll('<', '\\u003c') }}
      />
      <HomePage />
    </>
  );
}
