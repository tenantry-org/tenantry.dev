'use client';

import { Wordmark } from '@/components/shared/wordmark';
import { Button } from '@/components/ui/button';
import { login } from '@/app/login/actions';
import { FormEvent, useState, useTransition } from 'react';
import { AuthenticationForm } from '@/components/authentication/authentication-form';
import { useToast } from '@/components/ui/use-toast';

interface Props {
  /** Shown above the form, such as after a sign-in link that could not be completed. */
  notice?: string;
}

export function LoginForm({ notice }: Props) {
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, startTransition] = useTransition();

  function handleLogin(event: FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      // On success the action redirects, and the button stays pending until the next page shows.
      const data = await login({ email, password });
      if (data?.error) {
        toast({ description: 'Invalid email or password', variant: 'destructive' });
      }
    });
  }

  return (
    <form onSubmit={handleLogin} className={'px-6 md:px-16 pb-6 py-8 gap-6 flex flex-col items-center justify-center'}>
      <Wordmark className={'text-3xl'} />
      <div className={'text-[30px] leading-[36px] font-medium tracking-[-0.6px] text-center'}>
        Log in to your account
      </div>
      {notice && <p className={'text-sm text-muted-foreground text-center'}>{notice}</p>}
      <AuthenticationForm
        email={email}
        onEmailChange={(email) => setEmail(email)}
        password={password}
        onPasswordChange={(password) => setPassword(password)}
      />
      <Button type={'submit'} variant={'secondary'} className={'w-full'} disabled={pending} aria-busy={pending}>
        {pending ? 'Logging in…' : 'Log in'}
      </Button>
    </form>
  );
}
