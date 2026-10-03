import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ComparisonTable } from '@/components/home/comparison/comparison';

export function ComparisonSection() {
  return (
    <section className={'border-t border-border/70'}>
      <div className={'mx-auto max-w-6xl px-4 py-20 md:px-8 md:py-24'}>
        <h2 className={'text-3xl font-bold tracking-tight md:text-4xl'}>How Tenantry compares</h2>
        <p className={'mt-4 max-w-2xl text-lg text-muted-foreground'}>
          Most teams weigh their own query filters, Finbuckle.MultiTenant or ABP. The table includes what Tenantry does
          not do.
        </p>
        <div className={'mt-10'}>
          <ComparisonTable />
        </div>
        <Link
          href={'/compare'}
          className={'mt-6 inline-flex items-center gap-1 text-sm font-medium text-link hover:underline'}
        >
          The full comparison <ArrowRight className={'h-3.5 w-3.5'} />
        </Link>
      </div>
    </section>
  );
}
