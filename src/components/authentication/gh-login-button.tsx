'use client';

import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { signInWithGithub } from '@/app/login/actions';
import { GithubIcon } from '@/components/icons/github-icon';
import { useTransition } from 'react';

interface Props {
  label: string;
  /** The page to continue to after signing in, such as the checkout. */
  next?: string;
}
export function GhLoginButton({ label, next }: Props) {
  // Pending until GitHub's page loads: the action redirects there.
  const [pending, startTransition] = useTransition();

  return (
    <div className={'mt-6 flex flex-col gap-6'}>
      <div className={'flex items-center gap-4'}>
        <Separator className={'flex-1'} />
        <div className={'text-xs font-medium text-muted-foreground'}>or</div>
        <Separator className={'flex-1'} />
      </div>
      <Button
        onClick={() => startTransition(() => signInWithGithub(next))}
        variant={'outline'}
        className={'w-full'}
        disabled={pending}
        aria-busy={pending}
      >
        <GithubIcon className={'h-4 w-4'} />
        {pending ? 'Opening GitHub…' : label}
      </Button>
    </div>
  );
}
