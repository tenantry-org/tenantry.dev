import { Suspense } from 'react';
import Link from 'next/link';
import { AuthShell } from '@/components/shared/auth-shell';
import { LoginForm } from '@/components/authentication/login-form';
import { GhLoginButton } from '@/components/authentication/gh-login-button';
import { sitePath } from '@/lib/site-path';

const NOTICES: Record<string, string> = {
  link: 'That link could not sign you in here. If you were confirming your email, it is confirmed: log in below.',
};

interface Props {
  searchParams: Promise<{ error?: string; next?: string }>;
}

export default function LoginPage({ searchParams }: Props) {
  return (
    <Suspense fallback={<Login />}>
      <LoginWithParams searchParams={searchParams} />
    </Suspense>
  );
}

// The notice and the page to continue to come from the query string, so only they wait for the request.
async function LoginWithParams({ searchParams }: Props) {
  const { error, next } = await searchParams;
  const page = sitePath(next) ?? undefined;
  const notice = error
    ? NOTICES[error]
    : page?.startsWith('/checkout/')
      ? 'Log in to subscribe to Tenantry Pro.'
      : undefined;
  return <Login notice={notice} next={page} />;
}

function Login({ notice, next }: Readonly<{ notice?: string; next?: string }>) {
  return (
    <AuthShell
      footer={
        <>
          Don’t have an account?{' '}
          <Link
            href={next ? `/signup?next=${encodeURIComponent(next)}` : '/signup'}
            className={'font-medium text-link hover:underline'}
          >
            Sign up
          </Link>
        </>
      }
    >
      <LoginForm notice={notice} next={next} />
      <GhLoginButton label={'Log in with GitHub'} next={next} />
    </AuthShell>
  );
}
