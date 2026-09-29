import Link from 'next/link';
import { Button } from '@/components/ui/button';

export function HeroSection() {
  return (
    <section className={'mx-auto max-w-7xl px-[32px] relative flex flex-col items-center justify-between mt-16 mb-12'}>
      <div className={'text-center w-full'}>
        <h1 className={'text-[48px] leading-[48px] md:text-[80px] md:leading-[80px] tracking-[-1.6px] font-medium'}>
          Multi-tenancy for .NET,
          <br />
          done properly.
        </h1>
        <p className={'mx-auto mt-6 max-w-2xl text-[18px] leading-[27px] md:text-[20px] md:leading-[30px]'}>
          Tenantry gives .NET apps real tenant isolation — a shared database with row-level scoping, a database per
          tenant, or a schema per tenant — with provisioning, lifecycle management, and migration orchestration across
          tenant databases.
        </p>
        <p className={'mx-auto mt-4 max-w-2xl text-base text-muted-foreground'}>
          <span className={'text-primary font-medium'}>Core</span> is open source and free: tenant resolution and EF
          Core isolation in a shared database or a database per tenant.{' '}
          <span className={'text-primary font-medium'}>Pro</span> adds schema-per-tenant and mixed mode, provisioning
          and migrations across tenant databases, and Hangfire, MassTransit, Quartz &amp; Rebus integrations.
        </p>
        <div className={'mt-8 flex flex-wrap items-center justify-center gap-3'}>
          <Button asChild>
            <Link href={'/docs'}>Read the docs</Link>
          </Button>
          <Button asChild variant={'secondary'}>
            <Link href={'#pricing'}>See Pro pricing</Link>
          </Button>
          <Button asChild variant={'secondary'}>
            <Link href={'https://github.com/tenantry-org/tenantry-core'} target={'_blank'}>
              Star Core on GitHub
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
