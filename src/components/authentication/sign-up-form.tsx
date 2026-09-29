'use client';

import { Button } from '@/components/ui/button';
import { FormEvent, useState, useTransition } from 'react';
import { AuthenticationForm } from '@/components/authentication/authentication-form';
import { signup } from '@/app/signup/actions';
import { useToast } from '@/components/ui/use-toast';

export function SignupForm() {
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  // Sending the confirmation email can take a few seconds; the button says so and ignores further clicks.
  const [pending, startTransition] = useTransition();

  function handleSignup(event: FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await signup({ email, password });
      if ('error' in result) toast({ description: result.error, variant: 'destructive' });
      else setSentTo(email);
    });
  }

  if (sentTo) {
    return (
      <div className={'flex flex-col gap-4'}>
        <h1 className={'text-2xl font-semibold tracking-tight'}>Check your email</h1>
        <p className={'text-muted-foreground'}>
          We sent a confirmation link to <span className={'font-medium text-foreground'}>{sentTo}</span>. Open it to
          finish creating your account. If you already have an account with this address, log in instead.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSignup} className={'flex flex-col gap-5'}>
      <h1 className={'text-2xl font-semibold tracking-tight'}>Create an account</h1>
      <p className={'text-sm text-muted-foreground'}>
        Use the email address you buy Tenantry Pro with: your purchase is matched to your account by it.
      </p>
      <AuthenticationForm
        email={email}
        onEmailChange={(email) => setEmail(email)}
        password={password}
        onPasswordChange={(password) => setPassword(password)}
      />
      <Button type={'submit'} className={'w-full'} disabled={pending} aria-busy={pending}>
        {pending ? 'Creating your account…' : 'Sign up'}
      </Button>
    </form>
  );
}
