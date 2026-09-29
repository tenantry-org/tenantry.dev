import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/shared/auth-shell';
import { ResetPasswordForm } from '@/components/authentication/reset-password-form';
import { getCurrentUser } from '@/utils/supabase/current-user';

// Reached from a reset link, which signs the customer in through /auth/callback first.
export default function ResetPasswordPage() {
  return (
    <AuthShell footer={<>Your new password replaces the old one straight away.</>}>
      <Suspense>
        <SignedIn />
      </Suspense>
    </AuthShell>
  );
}

async function SignedIn() {
  if (!(await getCurrentUser())) redirect('/forgot-password?expired=1');
  return <ResetPasswordForm />;
}
