import { Suspense } from 'react';
import Link from 'next/link';
import { AuthShell } from '@/components/shared/auth-shell';
import { ForgotPasswordForm } from '@/components/authentication/forgot-password-form';

interface Props {
  searchParams: Promise<{ expired?: string }>;
}

export default function ForgotPasswordPage({ searchParams }: Props) {
  return (
    <AuthShell
      footer={
        <>
          Remembered it?{' '}
          <Link href={'/login'} className={'font-medium text-link hover:underline'}>
            Log in
          </Link>
        </>
      }
    >
      <Suspense fallback={<ForgotPasswordForm />}>
        <FormWithNotice searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}

// Only the notice depends on the request; the form around it is static.
async function FormWithNotice({ searchParams }: Props) {
  const { expired } = await searchParams;
  return (
    <ForgotPasswordForm
      notice={expired ? 'That reset link has expired or was already used. Request a new one.' : undefined}
    />
  );
}
