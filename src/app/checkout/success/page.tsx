import { CircleCheck } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { SimpleHeader } from '@/components/shared/simple-header';
import { Footer } from '@/components/home/footer/footer';
import { getCurrentUser } from '@/server/db/current-user';

interface Props {
  /** `from=pay`: a checkout opened by /pay, for an invoice, a failed renewal or a card update. */
  searchParams: Promise<{ from?: string }>;
}

export default function SuccessPage({ searchParams }: Props) {
  return (
    <div className={'flex min-h-screen flex-col bg-surface'}>
      <SimpleHeader />
      <main className={'flex flex-1 items-center justify-center px-4 py-20'}>
        <div className={'flex max-w-lg flex-col items-center text-center'}>
          <div className={'flex h-16 w-16 items-center justify-center rounded-full bg-success-surface'}>
            <CircleCheck className={'h-8 w-8 text-success'} aria-hidden={true} />
          </div>
          <Suspense>
            <Message searchParams={searchParams} />
          </Suspense>
        </div>
      </main>
      <Footer />
    </div>
  );
}

// The message comes from the query string, so only it waits for the request.
async function Message({ searchParams }: Props) {
  const { from } = await searchParams;

  if (from === 'pay') {
    // An existing subscriber: a card update takes no payment, so this does not say one was received.
    return (
      <>
        <h1 className={'mt-8 text-3xl font-bold tracking-tight md:text-4xl'}>Done</h1>
        <p className={'mt-4 text-lg text-muted-foreground'}>
          It can take a minute to show on your Pro access page. Your feed tokens and licence key are unchanged.
        </p>
        <div className={'mt-10'}>
          <Button size={'lg'} asChild={true}>
            <Link href={'/dashboard/pro'}>Go to your Pro access page</Link>
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className={'mt-8 text-3xl font-bold tracking-tight md:text-4xl'}>Thanks for subscribing</h1>
      <p className={'mt-4 text-lg text-muted-foreground'}>
        Next, create a feed token on your Pro access page: NuGet uses it to restore Tenantry Pro from the package feed.
        Your licence key is on the same page. The subscription can take a minute to show there.
      </p>
      <div className={'mt-10'}>
        {/* Auth out of reach shows the signed-out step, rather than failing the page. */}
        <NextStepButton signedIn={Boolean(await getCurrentUser().catch(() => null))} />
      </div>
    </>
  );
}

// Buyers are signed in to check out; one whose session has since ended logs in again, and lands on the same page.
function NextStepButton({ signedIn }: Readonly<{ signedIn: boolean }>) {
  return (
    <Button size={'lg'} asChild={true}>
      {signedIn ? (
        <Link href={'/dashboard/pro'}>Create a feed token</Link>
      ) : (
        <Link href={'/login'}>Log in to create a feed token</Link>
      )}
    </Button>
  );
}
