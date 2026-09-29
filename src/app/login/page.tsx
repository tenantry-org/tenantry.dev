import { LoginGradient } from '@/components/gradients/login-gradient';
import '../../styles/login.css';
import { LoginCardGradient } from '@/components/gradients/login-card-gradient';
import { LoginForm } from '@/components/authentication/login-form';
import { GhLoginButton } from '@/components/authentication/gh-login-button';
import { Suspense } from 'react';

const NOTICES: Record<string, string> = {
  link: 'That link could not sign you in here. If you were confirming your email, it is confirmed: log in below.',
};

interface Props {
  searchParams: Promise<{ error?: string }>;
}

export default function LoginPage({ searchParams }: Props) {
  return (
    <div>
      <LoginGradient />
      <div className={'flex flex-col'}>
        <div
          className={
            'mx-auto mt-[112px] bg-background/80 w-[343px] md:w-[488px] gap-5 flex-col rounded-lg rounded-b-none login-card-border backdrop-blur-[6px]'
          }
        >
          <LoginCardGradient />
          <Suspense fallback={<LoginForm />}>
            <LoginFormWithNotice searchParams={searchParams} />
          </Suspense>
        </div>
        <GhLoginButton label={'Log in with GitHub'} />
        <div
          className={
            'mx-auto w-[343px] md:w-[488px] bg-background/80 backdrop-blur-[6px] px-6 md:px-16 pt-0 py-8 gap-6 flex flex-col items-center justify-center rounded-b-lg'
          }
        >
          <div className={'text-center text-muted-foreground text-sm mt-4 font-medium'}>
            Don’t have an account?{' '}
            <a href={'/signup'} className={'text-white'}>
              Sign up
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

// The notice comes from the query string, so only it waits for the request; the form around it is static.
async function LoginFormWithNotice({ searchParams }: Props) {
  const { error } = await searchParams;
  return <LoginForm notice={error ? NOTICES[error] : undefined} />;
}
