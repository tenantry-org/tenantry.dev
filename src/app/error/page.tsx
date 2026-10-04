import type { Metadata } from 'next';
import Link from 'next/link';
import { SimpleHeader } from '@/components/shared/simple-header';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Error | Tenantry',
};

export default function ErrorPage() {
  return (
    <div className={'flex min-h-screen flex-col bg-surface'}>
      <SimpleHeader />
      <main className={'flex flex-1 flex-col items-center justify-center gap-6 px-4 py-20 text-center'}>
        <h1 className={'text-2xl font-bold tracking-tight'}>Something went wrong, please try again later</h1>
        <Button asChild={true} variant={'outline'}>
          <Link href={'/'}>Go to the home page</Link>
        </Button>
      </main>
    </div>
  );
}
