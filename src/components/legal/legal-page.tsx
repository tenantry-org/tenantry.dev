import { ReactNode } from 'react';
import Link from 'next/link';

interface Props {
  title: string;
  lastUpdated: string;
  children: ReactNode;
}

/**
 * Shared shell for legal documents. The content of each page is a TEMPLATE and must be reviewed by
 * legal counsel before launch — bracketed [PLACEHOLDERS] need real values (entity, address,
 * jurisdiction).
 */
export function LegalPage({ title, lastUpdated, children }: Props) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="text-sm text-muted-foreground hover:text-primary">
        ← Back to Tenantry
      </Link>
      <h1 className="mt-6 text-4xl font-medium tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: {lastUpdated}</p>
      <div className="mt-10 flex flex-col gap-4 leading-relaxed text-secondary [&_a]:text-primary [&_a]:underline [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-medium [&_h2]:text-primary [&_li]:ml-6 [&_li]:list-disc">
        {children}
      </div>
    </main>
  );
}
