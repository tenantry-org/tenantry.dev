import { ReactNode } from 'react';
import { SimpleHeader } from '@/components/shared/simple-header';
import { Footer } from '@/components/home/footer/footer';
import { legalEntityIncomplete } from '@/constants/legal-entity';

interface Props {
  title: string;
  lastUpdated: string;
  children: ReactNode;
}

/**
 * Shared shell for legal documents. The legal entity comes from constants/legal-entity.ts. Each page says it is an
 * unreviewed template only while the entity has placeholders: filling them in ends counsel's review and removes the
 * note, and a production server with checkout enabled refuses to start before then, so no real buyer accepts a page
 * that says it.
 */
export function LegalPage({ title, lastUpdated, children }: Props) {
  return (
    <div className={'flex min-h-screen flex-col'}>
      <SimpleHeader />
      <main className={'mx-auto w-full max-w-3xl flex-1 px-4 py-12 md:px-8 md:py-16'}>
        <h1 className={'text-3xl font-bold tracking-tight md:text-4xl'}>{title}</h1>
        <p className={'mt-2 text-sm text-muted-foreground'}>Last updated: {lastUpdated}</p>
        <div
          className={
            'mt-10 flex flex-col gap-4 leading-relaxed text-foreground/85 [&_a]:text-link [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:ml-6 [&_li]:list-disc'
          }
        >
          {children}
          {legalEntityIncomplete() && (
            <p className={'text-sm text-muted-foreground'}>
              This document is a template and must be reviewed by qualified legal counsel before launch.
            </p>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
