'use client';

import { FormEvent, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { setNewPassword } from '@/app/reset-password/actions';

export function ResetPasswordForm() {
  const { toast } = useToast();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmation) {
      toast({ description: 'The passwords do not match.', variant: 'destructive' });
      return;
    }
    startTransition(async () => {
      // On success the action redirects to the dashboard.
      const result = await setNewPassword(password);
      if (result?.error) toast({ description: result.error, variant: 'destructive' });
    });
  }

  return (
    <form onSubmit={handleSubmit} className={'flex flex-col gap-5'}>
      <h1 className={'text-2xl font-semibold tracking-tight'}>Choose a new password</h1>
      <div className={'grid w-full items-center gap-1.5'}>
        <Label className={'leading-5'} htmlFor={'password'}>
          New password
        </Label>
        <Input
          type={'password'}
          id={'password'}
          autoComplete={'new-password'}
          minLength={8}
          required={true}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className={'grid w-full items-center gap-1.5'}>
        <Label className={'leading-5'} htmlFor={'confirmation'}>
          Confirm new password
        </Label>
        <Input
          type={'password'}
          id={'confirmation'}
          autoComplete={'new-password'}
          minLength={8}
          required={true}
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
        />
      </div>
      <Button type={'submit'} className={'w-full'} disabled={pending} aria-busy={pending}>
        {pending ? 'Saving…' : 'Save password'}
      </Button>
    </form>
  );
}
