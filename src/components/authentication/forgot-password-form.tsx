'use client';

import { FormEvent, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { requestPasswordReset } from '@/app/forgot-password/actions';

interface Props {
  /** Shown above the form, such as when a reset link has expired. */
  notice?: string;
}

export function ForgotPasswordForm({ notice }: Props) {
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await requestPasswordReset(email);
      if ('error' in result) toast({ description: result.error, variant: 'destructive' });
      else setSentTo(email);
    });
  }

  if (sentTo) {
    return (
      <div className={'flex flex-col gap-4'}>
        <h1 className={'text-2xl font-semibold tracking-tight'}>Check your email</h1>
        <p className={'text-muted-foreground'}>
          If an account uses <span className={'font-medium text-foreground'}>{sentTo}</span>, we sent it a link to
          choose a new password. It works once, in this browser.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={'flex flex-col gap-5'}>
      <h1 className={'text-2xl font-semibold tracking-tight'}>Reset your password</h1>
      {notice && <p className={'rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground'}>{notice}</p>}
      <p className={'text-sm text-muted-foreground'}>
        Enter your account’s email address and we’ll send you a link to choose a new password.
      </p>
      <div className={'grid w-full items-center gap-1.5'}>
        <Label className={'leading-5'} htmlFor={'email'}>
          Email address
        </Label>
        <Input
          type={'email'}
          id={'email'}
          autoComplete={'username'}
          required={true}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <Button type={'submit'} className={'w-full'} disabled={pending} aria-busy={pending}>
        {pending ? 'Sending…' : 'Send reset link'}
      </Button>
    </form>
  );
}
