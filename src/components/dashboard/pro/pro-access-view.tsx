'use client';

import { type ReactNode, useState } from 'react';
import Link from 'next/link';
import { Check, Copy, Download } from 'lucide-react';
import { GithubIcon } from '@/components/icons/github-icon';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { connectGithub, switchGithubAccount } from '@/app/dashboard/pro/actions';
import type { ProAccess } from '@/utils/entitlements/get-entitlement';
import type { GithubState } from '@/utils/entitlements/entitlements-store';
import { BillingCard } from '@/components/dashboard/pro/billing-card';
import {
  CREATE_TOKEN_URL,
  FEED_TOKEN_VARIABLE,
  FEED_USERNAME_VARIABLE,
  LICENCE_CONFIG_KEY,
  LICENCE_ENV_VARIABLE,
  ciWorkflow,
  feedCredentials,
  licenceUserSecret,
  nugetConfig,
} from '@/utils/pro/install-snippets';

const INSTALL_GUIDE = '/docs/pro/installation';

interface Props {
  access: ProAccess;
  githubOrg: string;
  /** Why connecting GitHub failed (`?error=` from the link flow), if it did. */
  linkError?: string;
  /** The signed-in account's email, which a purchase must have been made with to appear here. */
  accountEmail: string | null;
}

const LINK_ERROR_TEXT: Record<string, ReactNode> = {
  'github-account-linked-elsewhere':
    'That GitHub account is already connected to another Tenantry customer. Connect a different account, or contact support@tenantry.dev.',
  'github-account-deleted':
    'The GitHub account connected to this login no longer exists on GitHub. Use another GitHub account.',
  'relink-failed':
    'We could not remove your previous GitHub account from the Tenantry org, so the new one was not connected. Try again in a moment.',
  'link-busy': 'Your access is being updated right now, so GitHub was not connected. Try again in a minute.',
  'sync-failed': 'Connecting GitHub failed. Try again in a moment; if it keeps failing, contact support@tenantry.dev.',
  'github-link': 'GitHub did not complete the connection. Try again in a moment.',
  'github-only-sign-in': (
    <>
      You sign in to Tenantry with GitHub only, so that account cannot be disconnected.{' '}
      <Link className={'underline underline-offset-4'} href={'/reset-password'}>
        Set a password
      </Link>{' '}
      first, then use another GitHub account.
    </>
  ),
};

function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type={'button'}
      variant={'outline'}
      size={'sm'}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className={'h-4 w-4'} /> : <Copy className={'h-4 w-4'} />}
      {copied ? 'Copied' : label}
    </Button>
  );
}

function Snippet({ value, label, maxHeight = 'max-h-48' }: { value: string; label?: string; maxHeight?: string }) {
  return (
    <div className={'flex flex-col gap-2'}>
      <code
        className={`block ${maxHeight} overflow-auto rounded-md border border-border bg-code p-3 font-mono text-xs whitespace-pre`}
      >
        {value}
      </code>
      {label && <CopyButton value={value} label={label} />}
    </div>
  );
}

function GithubStatus({
  state,
  invitationExpiresAt,
  githubOrg,
}: Readonly<{ state: GithubState; invitationExpiresAt: string | null; githubOrg: string }>) {
  if (state === 'active') {
    return (
      <p className={'text-sm text-muted-foreground'}>
        A member of the {githubOrg} org: you can restore Tenantry Pro packages from the private feed.
      </p>
    );
  }

  if (state === 'invited') {
    return (
      <div className={'flex flex-col gap-2 text-sm'}>
        <p className={'text-muted-foreground'}>
          GitHub has sent you an invitation to the {githubOrg} org. Accept it to restore Tenantry Pro packages
          {invitationExpiresAt
            ? ` (it lapses on ${new Date(invitationExpiresAt).toLocaleDateString()}, and we send a new one if it does)`
            : ''}
          .
        </p>
        <Link
          className={'text-link underline underline-offset-4'}
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
      <p className={'text-sm text-muted-foreground'}>
        Adding you to the {githubOrg} org failed. We retry automatically; you can also refresh below.
      </p>
    );
  }

  return (
    <p className={'text-sm text-muted-foreground'}>Link saved. Access is being provisioned: refresh in a moment.</p>
  );
}

const cardClass = 'p-6';

/** Whether the customer has Pro now: the pages show the no-subscription card otherwise. */
function isEntitled(access: ProAccess): access is ProAccess & { entitlement: NonNullable<ProAccess['entitlement']> } {
  return Boolean(access.entitlement) && access.entitlement?.status !== 'revoked';
}

function NoSubscription({ access, accountEmail }: Readonly<{ access: ProAccess; accountEmail: string | null }>) {
  return (
    <Card className={cardClass}>
      <CardHeader className={'p-0'}>
        <CardTitle>No active Tenantry Pro subscription</CardTitle>
      </CardHeader>
      <CardContent className={'p-0 pt-4 flex flex-col gap-4'}>
        <p className={'text-muted-foreground'}>
          Subscribe to Tenantry Pro to get the private package feed and your licence key.
        </p>
        {!access.customerId && accountEmail && (
          <p className={'text-muted-foreground'}>
            Purchases are matched to accounts by email address, and none was made with{' '}
            <span className={'font-medium text-foreground'}>{accountEmail}</span>. If you bought Tenantry Pro with
            another address, log in with an account for that address, or email{' '}
            <a className={'text-link underline underline-offset-4'} href={'mailto:support@tenantry.dev'}>
              support@tenantry.dev
            </a>
            .
          </p>
        )}
        {access.customerId && (
          <p className={'text-muted-foreground'}>
            Your invoices, and the payment method of a subscription whose payment failed, are in{' '}
            <Link className={'text-link underline underline-offset-4'} href={'/dashboard/pro/billing'}>
              Billing
            </Link>
            .
          </p>
        )}
        <Button asChild className={'w-fit'}>
          <Link href={'/#pricing'}>View pricing</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/** Access (/dashboard/pro): the GitHub connection and the licence key. */
export function AccessView({ access, githubOrg, linkError, accountEmail }: Props) {
  if (!isEntitled(access)) return <NoSubscription access={access} accountEmail={accountEmail} />;
  const { entitlement, licence, githubLogin } = access;

  return (
    <div className={'grid gap-6 lg:grid-cols-2'}>
      {/* GitHub connection */}
      <Card className={cardClass}>
        <CardHeader className={'p-0'}>
          <CardTitle>GitHub access</CardTitle>
        </CardHeader>
        <CardContent className={'p-0 pt-4 flex flex-col gap-3'}>
          {linkError && LINK_ERROR_TEXT[linkError] && (
            <p role={'alert'} className={'rounded-md bg-destructive-surface px-3 py-2 text-sm text-destructive'}>
              {LINK_ERROR_TEXT[linkError]}
            </p>
          )}
          {githubLogin ? (
            <>
              <p className={'text-muted-foreground'}>
                Connected as <span className={'font-medium text-foreground'}>@{githubLogin}</span>
              </p>
              <GithubStatus
                state={entitlement.github}
                invitationExpiresAt={entitlement.invitationExpiresAt}
                githubOrg={githubOrg}
              />
              <div className={'flex flex-wrap gap-2'}>
                <form action={connectGithub}>
                  <Button type={'submit'} variant={'outline'} size={'sm'}>
                    <GithubIcon className={'h-4 w-4'} /> Refresh access
                  </Button>
                </form>
                <form action={switchGithubAccount}>
                  <Button type={'submit'} variant={'outline'} size={'sm'}>
                    Use another GitHub account
                  </Button>
                </form>
              </div>
              <p className={'text-sm text-muted-foreground'}>
                To use another account, sign in to it on github.com first: GitHub connects whichever account you are
                signed in to. @{githubLogin} keeps access until the new account is connected.
              </p>
            </>
          ) : (
            <>
              <p className={'text-muted-foreground'}>
                Connect GitHub to get added to the <span className={'font-medium text-foreground'}>{githubOrg}</span>{' '}
                org, which grants access to the private Tenantry Pro package feed.
              </p>
              <form action={connectGithub}>
                <Button type={'submit'}>
                  <GithubIcon className={'h-4 w-4'} /> Connect GitHub
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
              <p className={'text-sm text-muted-foreground'}>
                It does not expire: renewals keep the same key. Keep it out of source control: Tenantry.Pro reads it
                from the configuration key <code>{LICENCE_CONFIG_KEY}</code>.
              </p>
              <code
                className={
                  'block max-h-24 overflow-auto rounded-md border border-border bg-code p-3 font-mono text-xs break-all'
                }
              >
                {licence.jwt}
              </code>
              <div className={'flex gap-2'}>
                <CopyButton value={licence.jwt} label={'Copy key'} />
                <Button
                  type={'button'}
                  variant={'outline'}
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
                  <Download className={'h-4 w-4'} /> Download
                </Button>
              </div>
              <p className={'text-sm text-muted-foreground'}>
                Locally, store it with user secrets, from your project&apos;s directory (they are read in the
                Development environment). In CI and other environments, set the environment variable{' '}
                <code>{LICENCE_ENV_VARIABLE}</code>.
              </p>
              <Snippet value={licenceUserSecret} />
            </>
          ) : (
            <p className={'text-muted-foreground'}>
              Your licence is being issued and will appear here shortly. If it can&apos;t be issued we are alerted
              automatically; you can also email{' '}
              <a className={'text-link underline underline-offset-4'} href={'mailto:support@tenantry.dev'}>
                support@tenantry.dev
              </a>
              .
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Install (/dashboard/pro/install): setting up the private package feed, locally and in CI. */
export function InstallView({ access, githubOrg, accountEmail }: Omit<Props, 'linkError'>) {
  if (!isEntitled(access)) return <NoSubscription access={access} accountEmail={accountEmail} />;
  const { githubLogin } = access;

  return (
    <div className={'max-w-4xl'}>
      <Card className={cardClass}>
        <CardHeader className={'p-0'}>
          <CardTitle>Install the packages</CardTitle>
        </CardHeader>
        <CardContent className={'p-0 pt-4 flex flex-col gap-4'}>
          <p className={'text-sm text-muted-foreground'}>
            Tenantry Pro&apos;s packages are on a private GitHub Packages feed; Tenantry core and everything else stay
            on nuget.org. The full guide, including Docker builds and troubleshooting, is{' '}
            <Link className={'text-link underline underline-offset-4'} href={INSTALL_GUIDE}>
              Installation
            </Link>
            .
          </p>

          <div className={'flex flex-col gap-2'}>
            <h3 className={'text-sm font-semibold'}>1. Create a token</h3>
            <p className={'text-sm text-muted-foreground'}>
              {githubLogin ? (
                <>
                  Signed in to GitHub as <span className={'font-medium text-foreground'}>@{githubLogin}</span>,{' '}
                </>
              ) : (
                <>Once GitHub is connected on the Access page, and signed in to GitHub as that account, </>
              )}
              <Link
                className={'text-link underline underline-offset-4'}
                href={CREATE_TOKEN_URL}
                target={'_blank'}
                rel={'noopener noreferrer'}
              >
                create a personal access token (classic)
              </Link>{' '}
              with only the <code>read:packages</code> scope, and give it an expiry date. GitHub Packages accepts
              classic tokens only, and only from an account with access to the feed.
            </p>
          </div>

          <div className={'flex flex-col gap-2'}>
            <h3 className={'text-sm font-semibold'}>2. Add this nuget.config next to your solution</h3>
            <p className={'text-sm text-muted-foreground'}>
              It holds no secrets, so commit it. It sends <code>Tenantry.Pro</code> and <code>Tenantry.Pro.*</code> to
              the private feed and everything else to nuget.org, and reads the credentials from two environment
              variables.
            </p>
            <Snippet value={nugetConfig(githubOrg)} label={'Copy nuget.config'} />
          </div>

          <div className={'flex flex-col gap-2'}>
            <h3 className={'text-sm font-semibold'}>3. Set the credentials</h3>
            <p className={'text-sm text-muted-foreground'}>
              On your machine (shell profile or user environment), then restart your terminal and IDE:
            </p>
            <Snippet value={feedCredentials(githubLogin)} label={'Copy'} />
          </div>

          <div className={'flex flex-col gap-2'}>
            <h3 className={'text-sm font-semibold'}>4. CI</h3>
            <p className={'text-sm text-muted-foreground'}>
              Store the token and the licence key as secrets. In GitHub Actions the workflow&apos;s own{' '}
              <code>GITHUB_TOKEN</code> cannot read another organisation&apos;s private packages, so pass your token:
            </p>
            <Snippet value={ciWorkflow} label={'Copy workflow'} />
            <p className={'text-sm text-muted-foreground'}>
              Other CI systems work the same way: <code>{FEED_USERNAME_VARIABLE}</code> and{' '}
              <code>{FEED_TOKEN_VARIABLE}</code> for the restore, <code>{LICENCE_ENV_VARIABLE}</code> for anything that
              starts the application.
            </p>
          </div>

          <div className={'flex flex-col gap-2'}>
            <h3 className={'text-sm font-semibold'}>Rotating credentials</h3>
            <ul className={'flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground'}>
              <li>
                When the token nears its expiry, create a new one the same way and update the environment variable and
                CI secret. Nothing else changes.
              </li>
              <li>
                If it may have leaked,{' '}
                <Link
                  className={'text-link underline underline-offset-4'}
                  href={'https://github.com/settings/tokens'}
                  target={'_blank'}
                  rel={'noopener noreferrer'}
                >
                  revoke it on GitHub
                </Link>{' '}
                straight away and create another.
              </li>
              <li>
                To move access to another GitHub account, choose Use another GitHub account on the Access page and
                accept the new account&apos;s invitation; the previous account loses access, so create the token from
                the new one.
              </li>
              <li>The licence key never needs rotating.</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Billing (/dashboard/pro/billing): the subscription card, for anyone with a billing account, entitled or not. A
 * customer whose access ended still needs it: to update the payment method that failed, or for their invoices.
 */
export function BillingView({ access, accountEmail }: Pick<Props, 'access' | 'accountEmail'>) {
  if (!access.customerId) return <NoSubscription access={access} accountEmail={accountEmail} />;

  return (
    <div className={'max-w-3xl'}>
      <BillingCard entitlement={access.entitlement} subscriptions={access.subscriptions} cardClass={cardClass} />
    </div>
  );
}
