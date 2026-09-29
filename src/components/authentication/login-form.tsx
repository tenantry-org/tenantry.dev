'use client';

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
    <form onSubmit={handleLogin} className={'flex flex-col gap-5'}>
      <h1 className={'text-2xl font-semibold tracking-tight'}>Log in to your account</h1>
      {notice && <p className={'rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground'}>{notice}</p>}
      <AuthenticationForm
        email={email}
        onEmailChange={(email) => setEmail(email)}
        password={password}
        onPasswordChange={(password) => setPassword(password)}
      />
      <Button type={'submit'} className={'w-full'} disabled={pending} aria-busy={pending}>
        {pending ? 'Logging in…' : 'Log in'}
      </Button>
    </form>
  );
}
