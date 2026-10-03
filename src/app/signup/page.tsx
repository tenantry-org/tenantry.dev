import { Suspense } from 'react';
import Link from 'next/link';
import { AuthShell } from '@/components/shared/auth-shell';
import { GhLoginButton } from '@/components/authentication/gh-login-button';
import { SignupForm } from '@/components/authentication/sign-up-form';
import { sitePath } from '@/lib/site-path';

interface Props {
  searchParams: Promise<{ next?: string }>;
}

export default function SignupPage({ searchParams }: Props) {
  return (
    <Suspense fallback={<Signup />}>
      <SignupWithParams searchParams={searchParams} />
    </Suspense>
  );
}

// The page to continue to, such as the checkout, comes from the query string, so only it waits for the request.
async function SignupWithParams({ searchParams }: Props) {
  const { next } = await searchParams;
  return <Signup next={sitePath(next) ?? undefined} />;
}

function Signup({ next }: Readonly<{ next?: string }>) {
  return (
    <AuthShell
      footer={
        <>
          Already have an account?{' '}
          <Link
            href={next ? `/login?next=${encodeURIComponent(next)}` : '/login'}
            className={'font-medium text-link hover:underline'}
          >
            Log in
          </Link>
        </>
      }
    >
      <SignupForm next={next} />
      <GhLoginButton label={'Sign up with GitHub'} next={next} />
    </AuthShell>
  );
}
