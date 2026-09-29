import Link from 'next/link';
import { AuthShell } from '@/components/shared/auth-shell';
import { GhLoginButton } from '@/components/authentication/gh-login-button';
import { SignupForm } from '@/components/authentication/sign-up-form';

export default function SignupPage() {
  return (
    <AuthShell
      footer={
        <>
          Already have an account?{' '}
          <Link href={'/login'} className={'font-medium text-link hover:underline'}>
            Log in
          </Link>
        </>
      }
    >
      <SignupForm />
      <GhLoginButton label={'Sign up with GitHub'} />
    </AuthShell>
  );
}
