'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, Copy, Download } from 'lucide-react';
import { GithubIcon } from '@/components/icons/github-icon';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { connectGithub } from '@/app/dashboard/pro/actions';
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
  licenceRegistration,
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

const LINK_ERROR_TEXT: Record<string, string> = {
  'github-account-linked-elsewhere':
    'That GitHub account is already connected to another Tenantry customer. Connect a different account, or contact support@tenantry.dev.',
  'relink-failed':
    'We could not remove your previous GitHub account from the Tenantry org, so the new one was not connected. Try again in a moment.',
  'link-busy': 'Your access is being updated right now, so GitHub was not connected. Try again in a minute.',
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

function Snippet({ value, label, maxHeight = 'max-h-48' }: { value: string; label?: string; maxHeight?: string }) {
  return (
    <div className={'flex flex-col gap-2'}>
      <code className={`block ${maxHeight} overflow-auto rounded-xs bg-muted/40 p-3 text-xs whitespace-pre`}>
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

const cardClass = 'bg-background/50 backdrop-blur-[24px] border-border p-6';

export function ProAccessView({ access, githubOrg, linkError, accountEmail }: Props) {
  const { entitlement, licence, githubLogin } = access;

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
      <BillingCard entitlement={entitlement} subscriptions={access.subscriptions} cardClass={cardClass} />

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
                  <GithubIcon className={'mr-2 h-4 w-4'} /> Refresh access
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
                  <GithubIcon className={'mr-2 h-4 w-4'} /> Connect GitHub
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
                It does not expire: renewals keep the same key. Keep it out of source control and pass it to{' '}
                <code>pro.WithLicence</code>, here from the configuration key <code>{LICENCE_CONFIG_KEY}</code>:
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
              <Snippet value={licenceRegistration} maxHeight={'max-h-32'} />
              <p className={'text-secondary text-sm'}>
                Locally, store it with user secrets. In CI and other environments, set the environment variable{' '}
                <code>{LICENCE_ENV_VARIABLE}</code>.
              </p>
              <Snippet value={licenceUserSecret} />
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
      <Card className={`${cardClass} lg:col-span-2`}>
        <CardHeader className={'p-0'}>
          <CardTitle>Install the packages</CardTitle>
        </CardHeader>
        <CardContent className={'p-0 pt-4 flex flex-col gap-4'}>
          <p className={'text-secondary text-sm'}>
            Tenantry Pro&apos;s packages are on a private GitHub Packages feed; Tenantry core and everything else stay
            on nuget.org. The full guide, including Docker builds and troubleshooting, is{' '}
            <Link className={'text-primary underline underline-offset-4'} href={INSTALL_GUIDE}>
              Installation
            </Link>
            .
          </p>

          <div className={'flex flex-col gap-2'}>
            <h3 className={'text-primary text-sm font-medium'}>1. Create a token</h3>
            <p className={'text-secondary text-sm'}>
              {githubLogin ? (
                <>
                  Signed in to GitHub as <span className={'text-primary'}>@{githubLogin}</span>,{' '}
                </>
              ) : (
                <>Once GitHub is connected above, and signed in to GitHub as that account, </>
              )}
              <Link
                className={'text-primary underline underline-offset-4'}
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
            <h3 className={'text-primary text-sm font-medium'}>2. Add this nuget.config next to your solution</h3>
            <p className={'text-secondary text-sm'}>
              It holds no secrets, so commit it. It sends <code>Tenantry.Pro</code> and <code>Tenantry.Pro.*</code> to
              the private feed and everything else to nuget.org, and reads the credentials from two environment
              variables.
            </p>
            <Snippet value={nugetConfig(githubOrg)} label={'Copy nuget.config'} />
          </div>

          <div className={'flex flex-col gap-2'}>
            <h3 className={'text-primary text-sm font-medium'}>3. Set the credentials</h3>
            <p className={'text-secondary text-sm'}>
              On your machine (shell profile or user environment), then restart your terminal and IDE:
            </p>
            <Snippet value={feedCredentials(githubLogin)} label={'Copy'} />
          </div>

          <div className={'flex flex-col gap-2'}>
            <h3 className={'text-primary text-sm font-medium'}>4. CI</h3>
            <p className={'text-secondary text-sm'}>
              Store the token and the licence key as secrets. In GitHub Actions the workflow&apos;s own{' '}
              <code>GITHUB_TOKEN</code> cannot read another organisation&apos;s private packages, so pass your token:
            </p>
            <Snippet value={ciWorkflow} label={'Copy workflow'} />
            <p className={'text-secondary text-sm'}>
              Other CI systems work the same way: <code>{FEED_USERNAME_VARIABLE}</code> and{' '}
              <code>{FEED_TOKEN_VARIABLE}</code> for the restore, <code>{LICENCE_ENV_VARIABLE}</code> for anything that
              starts the application.
            </p>
          </div>

          <div className={'flex flex-col gap-2'}>
            <h3 className={'text-primary text-sm font-medium'}>Rotating credentials</h3>
            <ul className={'text-secondary text-sm list-disc pl-5 flex flex-col gap-1'}>
              <li>
                When the token nears its expiry, create a new one the same way and update the environment variable and
                CI secret. Nothing else changes.
              </li>
              <li>
                If it may have leaked,{' '}
                <Link
                  className={'text-primary underline underline-offset-4'}
                  href={'https://github.com/settings/tokens'}
                  target={'_blank'}
                  rel={'noopener noreferrer'}
                >
                  revoke it on GitHub
                </Link>{' '}
                straight away and create another.
              </li>
              <li>
                To move access to another GitHub account, connect it above and accept its invitation; the previous
                account loses access, so create the token from the new one.
              </li>
              <li>The licence key never needs rotating.</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
