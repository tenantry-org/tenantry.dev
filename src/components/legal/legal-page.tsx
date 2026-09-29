import { ReactNode } from 'react';
import { SimpleHeader } from '@/components/shared/simple-header';
import { Footer } from '@/components/home/footer/footer';

interface Props {
  title: string;
  lastUpdated: string;
  children: ReactNode;
}

/**
 * Shared shell for legal documents. The content of each page is a TEMPLATE and must be reviewed by
 * legal counsel before launch. The legal entity comes from constants/legal-entity.ts (plan item 4.7).
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
        </div>
      </main>
      <Footer />
    </div>
  );
}
