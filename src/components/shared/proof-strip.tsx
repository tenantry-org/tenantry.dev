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

const SAMPLES = {
  core: {
    text: `${samples.core} runnable Core samples`,
    href: `https://github.com/tenantry-org/tenantry-core/tree/${latestDocsVersion.core}/samples`,
  },
  all: {
    text: `${samples.core + samples.pro} runnable samples: ${samples.core} for Core, ${samples.pro} for Pro`,
    href: `https://github.com/tenantry-org/tenantry-pro-docs/tree/${latestDocsVersion.pro}/samples`,
  },
};

const LICENCE = { text: 'Core is Apache-2.0, on GitHub', href: 'https://github.com/tenantry-org/tenantry-core' };

/** A strip of facts a reader can check, each linked to where to check it; `samples` picks Core's samples or both. */
export function ProofStrip({ samples: which }: Readonly<{ samples: keyof typeof SAMPLES }>) {
  return (
    <section className={'border-b border-border/70 bg-surface'}>
      <ul
        className={
          'mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 text-sm text-muted-foreground md:flex-row md:gap-8 md:px-8'
        }
      >
        {[TESTS, SAMPLES[which], LICENCE].map((item) => (
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
