import { Suspense } from 'react';
import Link from 'next/link';
import { AuthShell } from '@/components/shared/auth-shell';
import { LoginForm } from '@/components/authentication/login-form';
import { GhLoginButton } from '@/components/authentication/gh-login-button';

const NOTICES: Record<string, string> = {
  link: 'That link could not sign you in here. If you were confirming your email, it is confirmed: log in below.',
};

interface Props {
  searchParams: Promise<{ error?: string }>;
}

export default function LoginPage({ searchParams }: Props) {
  return (
    <AuthShell
      footer={
        <>
          Don’t have an account?{' '}
          <Link href={'/signup'} className={'font-medium text-link hover:underline'}>
            Sign up
          </Link>
        </>
      }
    >
      <Suspense fallback={<LoginForm />}>
        <LoginFormWithNotice searchParams={searchParams} />
      </Suspense>
      <GhLoginButton label={'Log in with GitHub'} />
    </AuthShell>
  );
}

// The notice comes from the query string, so only it waits for the request; the form around it is static.
async function LoginFormWithNotice({ searchParams }: Props) {
  const { error } = await searchParams;
  return <LoginForm notice={error ? NOTICES[error] : undefined} />;
}
