'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, Copy, Download, Github } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { connectGithub } from '@/app/dashboard/pro/actions';
import type { ProAccess } from '@/utils/entitlements/get-entitlement';
import type { GithubState } from '@/utils/entitlements/entitlements-store';
import { ProOffer } from '@/constants/pro-offer';

interface Props {
  access: ProAccess;
  githubOrg: string;
  /** Why connecting GitHub failed (`?error=` from the link flow), if it did. */
  linkError?: string;
  /** The signed-in account's email, which a purchase must have been made with to appear here. */
  accountEmail: string | null;
}

const LINK_ERROR_TEXT: Record<string, string> = {
  'github-account-linked-elsewhere':
    'That GitHub account is already connected to another Tenantry customer. Connect a different account, or contact support@tenantry.dev.',
  'relink-failed':
    'We could not remove your previous GitHub account from the Tenantry org, so the new one was not connected. Try again in a moment.',
  'sync-failed': 'Connecting GitHub failed. Try again in a moment; if it keeps failing, contact support@tenantry.dev.',
  'github-link': 'GitHub did not complete the connection. Try again in a moment.',
};

function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type={'button'}
      variant={'secondary'}
      size={'sm'}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className={'mr-2 h-4 w-4'} /> : <Copy className={'mr-2 h-4 w-4'} />}
      {copied ? 'Copied' : label}
    </Button>
  );
}

function GithubStatus({
  state,
  invitationExpiresAt,
  githubOrg,
}: Readonly<{ state: GithubState; invitationExpiresAt: string | null; githubOrg: string }>) {
  if (state === 'active') {
    return (
      <p className={'text-secondary text-sm'}>
        A member of the {githubOrg} org: you can restore Tenantry Pro packages from the private feed.
      </p>
    );
  }

  if (state === 'invited') {
    return (
      <div className={'flex flex-col gap-2 text-sm'}>
        <p className={'text-secondary'}>
          GitHub has sent you an invitation to the {githubOrg} org. Accept it to restore Tenantry Pro packages
          {invitationExpiresAt
            ? ` (it lapses on ${new Date(invitationExpiresAt).toLocaleDateString()}, and we send a new one if it does)`
            : ''}
          .
        </p>
        <Link
          className={'text-primary underline underline-offset-4'}
          href={`https://github.com/orgs/${githubOrg}/invitation`}
          target={'_blank'}
          rel={'noopener noreferrer'}
        >
          Accept the invitation on GitHub
        </Link>
      </div>
    );
  }

  if (state === 'failed') {
    return (
      <p className={'text-secondary text-sm'}>
        Adding you to the {githubOrg} org failed. We retry automatically; you can also refresh below.
      </p>
    );
  }

  return <p className={'text-secondary text-sm'}>Link saved. Access is being provisioned: refresh in a moment.</p>;
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'active'
      ? 'bg-green-500/15 text-green-400'
      : status === 'grace'
        ? 'bg-yellow-500/15 text-yellow-400'
        : 'bg-red-500/15 text-red-400';

  return <span className={`rounded-xs px-2 py-1 text-xs font-medium ${tone}`}>{status}</span>;
}

const cardClass = 'bg-background/50 backdrop-blur-[24px] border-border p-6';

function GraceNotice({ grace }: Readonly<{ grace: { endsAt: string; ended: boolean } | null }>) {
  const updatePaymentMethod = <Link href={'/dashboard/subscriptions'}>Update your payment method</Link>;
  const ends = grace ? new Date(grace.endsAt).toLocaleDateString() : null;

  if (grace?.ended) {
    return (
      <p className={'text-secondary text-sm'}>
        Your last payment failed, and the 30-day grace period ended on {ends}. {updatePaymentMethod} to restore access.
      </p>
    );
  }

  return (
    <p className={'text-secondary text-sm'}>
      Your last payment failed. Your access to the package feed continues{ends ? ` until ${ends}` : ''} while Paddle
      retries it. {updatePaymentMethod} to keep it.
    </p>
  );
}

export function ProAccessView({ access, githubOrg, linkError, accountEmail }: Props) {
  const { entitlement, licence, githubLogin } = access;

  const nugetConfig = `<configuration>
  <packageSources>
    <add key="github" value="https://nuget.pkg.github.com/${githubOrg}/index.json" />
  </packageSources>
  <packageSourceCredentials>
    <github>
      <add key="Username" value="YOUR_GITHUB_USERNAME" />
      <add key="ClearTextPassword" value="%GITHUB_PAT%" />
    </github>
  </packageSourceCredentials>
</configuration>`;

  if (!entitlement || entitlement.status === 'revoked') {
    return (
      <Card className={cardClass}>
        <CardHeader className={'p-0'}>
          <CardTitle>No active Tenantry Pro subscription</CardTitle>
        </CardHeader>
        <CardContent className={'p-0 pt-4 flex flex-col gap-4'}>
          <p className={'text-secondary'}>
            Subscribe to Tenantry Pro to get the private package feed and your licence key.
          </p>
          {!access.customerId && accountEmail && (
            <p className={'text-secondary'}>
              Purchases are matched to accounts by email address, and none was made with{' '}
              <span className={'text-primary'}>{accountEmail}</span>. If you bought Tenantry Pro with another address,
              log in with an account for that address, or email{' '}
              <a href={'mailto:support@tenantry.dev'}>support@tenantry.dev</a>.
            </p>
          )}
          <Button asChild className={'w-fit'}>
            <Link href={'/#pricing'}>View pricing</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={'grid gap-6 lg:grid-cols-2'}>
      {/* Entitlement status */}
      <Card className={cardClass}>
        <CardHeader className={'p-0'}>
          <CardTitle className={'flex items-center justify-between'}>
            <span>Subscription</span>
            <StatusBadge status={entitlement.status} />
          </CardTitle>
        </CardHeader>
        <CardContent className={'p-0 pt-4 flex flex-col gap-3'}>
          <p className={'text-secondary'}>
            Plan: <span className={'text-primary font-medium'}>{ProOffer.name}</span>
          </p>
          {entitlement.status === 'grace' && <GraceNotice grace={entitlement.grace} />}
        </CardContent>
      </Card>

      {/* GitHub connection */}
      <Card className={cardClass}>
        <CardHeader className={'p-0'}>
          <CardTitle>GitHub access</CardTitle>
        </CardHeader>
        <CardContent className={'p-0 pt-4 flex flex-col gap-3'}>
          {linkError && LINK_ERROR_TEXT[linkError] && (
            <p role={'alert'} className={'text-sm text-red-400'}>
              {LINK_ERROR_TEXT[linkError]}
            </p>
          )}
          {githubLogin ? (
            <>
              <p className={'text-secondary'}>
                Connected as <span className={'text-primary font-medium'}>@{githubLogin}</span>
              </p>
              <GithubStatus
                state={entitlement.github}
                invitationExpiresAt={entitlement.invitationExpiresAt}
                githubOrg={githubOrg}
              />
              <form action={connectGithub}>
                <Button type={'submit'} variant={'secondary'} size={'sm'}>
                  <Github className={'mr-2 h-4 w-4'} /> Refresh access
                </Button>
              </form>
            </>
          ) : (
            <>
              <p className={'text-secondary'}>
                Connect GitHub to get added to the <span className={'text-primary'}>{githubOrg}</span> org, which grants
                access to the private Tenantry Pro package feed.
              </p>
              <form action={connectGithub}>
                <Button type={'submit'}>
                  <Github className={'mr-2 h-4 w-4'} /> Connect GitHub
                </Button>
              </form>
            </>
          )}
        </CardContent>
      </Card>

      {/* Licence key */}
      <Card className={cardClass}>
        <CardHeader className={'p-0'}>
          <CardTitle>Licence key</CardTitle>
        </CardHeader>
        <CardContent className={'p-0 pt-4 flex flex-col gap-3'}>
          {licence ? (
            <>
              <p className={'text-secondary text-sm'}>
                Set it as <code>Tenantry:Licence</code> in your app configuration, and as a secret in CI. It does not
                expire: renewals keep the same key.
              </p>
              <code className={'block max-h-24 overflow-auto rounded-xs bg-muted/40 p-3 text-xs break-all'}>
                {licence.jwt}
              </code>
              <div className={'flex gap-2'}>
                <CopyButton value={licence.jwt} label={'Copy key'} />
                <Button
                  type={'button'}
                  variant={'secondary'}
                  size={'sm'}
                  onClick={() => {
                    const blob = new Blob([licence.jwt], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const anchor = document.createElement('a');
                    anchor.href = url;
                    anchor.download = 'tenantry-pro.licence';
                    anchor.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <Download className={'mr-2 h-4 w-4'} /> Download
                </Button>
              </div>
            </>
          ) : (
            <p className={'text-secondary'}>
              Your licence is being issued and will appear here shortly. If it can&apos;t be issued we are alerted
              automatically; you can also email <a href={'mailto:support@tenantry.dev'}>support@tenantry.dev</a>.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Feed setup */}
      <Card className={cardClass}>
        <CardHeader className={'p-0'}>
          <CardTitle>Install the packages</CardTitle>
        </CardHeader>
        <CardContent className={'p-0 pt-4 flex flex-col gap-3'}>
          <p className={'text-secondary text-sm'}>
            Create a GitHub PAT with the <code>read:packages</code> scope, then add this <code>nuget.config</code> to
            your solution (the PAT goes in the <code>GITHUB_PAT</code> env var):
          </p>
          <code className={'block max-h-48 overflow-auto rounded-xs bg-muted/40 p-3 text-xs whitespace-pre'}>
            {nugetConfig}
          </code>
          <CopyButton value={nugetConfig} label={'Copy nuget.config'} />
        </CardContent>
      </Card>
    </div>
  );
}
