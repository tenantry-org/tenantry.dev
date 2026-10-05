'use client';

import { type FormEvent, useState, useTransition } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Confirmation } from '@/components/shared/confirmation/confirmation';
import { CopyButton } from '@/components/dashboard/pro/copy-button';
import { formatDate } from '@/components/dashboard/pro/format-date';
import { createFeedToken, revokeFeedToken } from '@/app/dashboard/pro/actions';
import type { FeedTokenView } from '@/server/billing/pro-pages';

interface Props {
  tokens: FeedTokenView[];
  /** Whether the package feed serves the customer anything, so a new token would restore something. */
  canCreate: boolean;
  /** The most live tokens a customer holds at once. */
  limit: number;
}

/**
 * The customer's feed tokens: creating one (shown once, with a copy button, and never again), the list with when each
 * was last used, and revoking one. The token is held only in this component's state until the customer dismisses it.
 */
export function FeedTokensCard({ tokens, canCreate, limit }: Readonly<Props>) {
  const [busy, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<FeedTokenView | null>(null);
  const full = tokens.length >= limit;

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createFeedToken(name);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setCreated({ token: result.token, name: result.name });
      setName('');
    });
  }

  function revoke() {
    const token = revoking;
    setRevoking(null);
    if (!token) return;
    setError(null);
    startTransition(async () => {
      const result = await revokeFeedToken(token.id);
      if ('error' in result) setError(result.error);
    });
  }

  return (
    <Card className={'p-6'}>
      <CardHeader className={'p-0'}>
        <CardTitle>Feed tokens</CardTitle>
      </CardHeader>
      <CardContent className={'p-0 pt-4 flex flex-col gap-4 text-sm'}>
        <p className={'text-muted-foreground'}>
          NuGet sends a feed token to the package feed as its password. Up to {limit} can exist at once, and how you use
          them is up to you: one for each developer machine and CI system lets you revoke one without affecting the
          others. They are for your company&apos;s use only, or yours if you are a single developer. The{' '}
          <Link className={'text-link underline underline-offset-4'} href={'/dashboard/pro/install'}>
            Install page
          </Link>{' '}
          shows where it goes.
        </p>

        {created && (
          <div className={'flex flex-col gap-2 rounded-md border border-border p-3'} role={'status'}>
            <p className={'font-medium'}>Copy the feed token {created.name} now. It is not shown again.</p>
            <code className={'block rounded-md bg-code p-3 font-mono text-xs break-all'}>{created.token}</code>
            <div className={'flex gap-2'}>
              <CopyButton value={created.token} label={'Copy token'} />
              <Button type={'button'} variant={'outline'} size={'sm'} onClick={() => setCreated(null)}>
                Done
              </Button>
            </div>
          </div>
        )}

        {error && (
          <p role={'alert'} className={'rounded-md bg-destructive-surface px-3 py-2 text-destructive'}>
            {error}
          </p>
        )}

        {canCreate && !full && (
          <form className={'flex flex-col gap-2'} onSubmit={create}>
            <Label htmlFor={'feed-token-name'}>Name</Label>
            <div className={'flex gap-2'}>
              <Input
                id={'feed-token-name'}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={'For example, build server or Sam’s laptop'}
                maxLength={60}
                required
              />
              <Button type={'submit'} disabled={busy || !name.trim()}>
                Create
              </Button>
            </div>
          </form>
        )}
        {canCreate && full && (
          <p className={'text-muted-foreground'}>
            You have {limit} feed tokens, the most you can hold at once. Revoke one you no longer use to create another.
          </p>
        )}
        {!canCreate && (
          <p className={'text-muted-foreground'}>
            No feed token can be created while the package feed serves you nothing. You can still revoke the ones below.
          </p>
        )}

        {tokens.length === 0 ? (
          <p className={'text-muted-foreground'}>You have no feed tokens.</p>
        ) : (
          <ul className={'flex flex-col divide-y divide-border border-y border-border'}>
            {tokens.map((token) => (
              <li key={token.id} className={'flex items-center justify-between gap-3 py-3'}>
                <div className={'flex flex-col gap-0.5'}>
                  <span className={'font-medium'}>{token.name}</span>
                  <span className={'text-muted-foreground'}>
                    <code>{token.prefix}…</code>, created {formatDate(token.createdAt)},{' '}
                    {token.lastUsedAt ? `last used ${formatDate(token.lastUsedAt)}` : 'not used yet'}
                  </span>
                </div>
                <Button
                  type={'button'}
                  variant={'outline'}
                  size={'sm'}
                  disabled={busy}
                  onClick={() => setRevoking(token)}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Confirmation
        isOpen={revoking !== null}
        onClose={() => setRevoking(null)}
        onConfirm={revoke}
        title={`Revoke ${revoking?.name ?? 'the feed token'}?`}
        description={
          'The package feed refuses it from now on, so a restore that needs to download with it fails. Your other feed tokens keep working, and a revoked token cannot be used again.'
        }
        confirmLabel={'Revoke'}
        destructive
      />
    </Card>
  );
}
