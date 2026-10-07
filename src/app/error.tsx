'use client';

import Link from 'next/link';
import { SimpleHeader } from '@/components/shared/simple-header';
import { Button } from '@/components/ui/button';

// Shown in place of a page that fails to render, such as a dashboard page whose read failed or while Auth is out of
// reach. It sits at the app root so that it also covers the dashboard's layout, which checks the session. Retrying
// renders the page again from the server.
export default function PageError({ retry }: Readonly<{ retry: () => void }>) {
  return (
    <div className={'flex min-h-screen flex-col bg-surface'}>
      <SimpleHeader />
      <main className={'flex flex-1 flex-col items-center justify-center gap-6 px-4 py-20 text-center'}>
        <h1 className={'text-2xl font-bold tracking-tight'}>This page could not load</h1>
        <p className={'text-muted-foreground'}>Try again in a moment.</p>
        <div className={'flex flex-wrap justify-center gap-3'}>
          <Button onClick={() => retry()}>Try again</Button>
          <Button asChild={true} variant={'outline'}>
            <Link href={'/'}>Go to the home page</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
