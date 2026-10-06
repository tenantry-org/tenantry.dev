import Link from 'next/link';
import { latestDocsVersion } from '@/lib/docs-versions';
import newestRelease from '../../../newest-release.json';

// What a reader can check for themselves: the databases Core's isolation tests run against on every build (Core's
// compatibility guide), the samples counted at the newest release's tags (newest-release.json), and Core's licence.
const { samples } = newestRelease;

const TESTS = {
  text: 'Core’s isolation tests run on every build against SQL Server, PostgreSQL, MySQL and SQLite',
  href: '/docs/core/compatibility#databases',
};

const CORE_SAMPLES = {
  text: `${samples.core} runnable Core samples`,
  href: `https://github.com/tenantry-org/tenantry-core/tree/${latestDocsVersion.core}/samples`,
};

const PRO_SAMPLES = {
  text: `${samples.pro} runnable Pro samples`,
  href: `https://github.com/tenantry-org/tenantry-pro-docs/tree/${latestDocsVersion.pro}/samples`,
};

// Each count links to the repository that holds those samples.
const SAMPLES = { core: [CORE_SAMPLES], all: [CORE_SAMPLES, PRO_SAMPLES] };

const LICENCE = {
  text: 'Core is Apache-2.0: free for commercial use',
  href: 'https://github.com/tenantry-org/tenantry-core',
};

/** A strip of facts a reader can check, each linked to where to check it; `samples` picks Core's samples or both products'. */
export function ProofStrip({ samples: which }: Readonly<{ samples: keyof typeof SAMPLES }>) {
  return (
    <section className={'border-b border-border/70 bg-surface'}>
      <ul
        className={
          'mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 text-sm text-muted-foreground md:flex-row md:gap-8 md:px-8'
        }
      >
        {[TESTS, ...SAMPLES[which], LICENCE].map((item) => (
          <li key={item.text}>
            <Link href={item.href} className={'hover:text-foreground hover:underline'}>
              {item.text}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
