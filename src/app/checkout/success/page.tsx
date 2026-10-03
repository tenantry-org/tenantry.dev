import { CircleCheck } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { SimpleHeader } from '@/components/shared/simple-header';
import { Footer } from '@/components/home/footer/footer';
import { getCurrentUser } from '@/server/db/current-user';

export default function SuccessPage() {
  return (
    <div className={'flex min-h-screen flex-col bg-surface'}>
      <SimpleHeader />
      <main className={'flex flex-1 items-center justify-center px-4 py-20'}>
        <div className={'flex max-w-lg flex-col items-center text-center'}>
          <div className={'flex h-16 w-16 items-center justify-center rounded-full bg-success-surface'}>
            <CircleCheck className={'h-8 w-8 text-success'} aria-hidden={true} />
          </div>
          <h1 className={'mt-8 text-3xl font-bold tracking-tight md:text-4xl'}>Thanks for subscribing</h1>
          <p className={'mt-4 text-lg text-muted-foreground'}>
            Next, connect your GitHub account to get the private package feed. Your licence key is on the same page. The
            subscription can take a minute to show there.
          </p>
          <div className={'mt-10'}>
            <Suspense fallback={<NextStepButton signedIn={false} />}>
              <SignedInNextStep />
            </Suspense>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

// Buyers are signed in to check out; one whose session has since ended logs in again, and lands on the same page.
async function SignedInNextStep() {
  return <NextStepButton signedIn={Boolean(await getCurrentUser())} />;
}

function NextStepButton({ signedIn }: Readonly<{ signedIn: boolean }>) {
  return (
    <Button size={'lg'} asChild={true}>
      {signedIn ? (
        <Link href={'/dashboard/pro'}>Connect GitHub</Link>
      ) : (
        <Link href={'/login'}>Log in to connect GitHub</Link>
      )}
    </Button>
  );
}
