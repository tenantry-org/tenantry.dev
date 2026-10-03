import type { ReactNode } from 'react';
import Link from 'next/link';
import { GithubIcon } from '@/components/icons/github-icon';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { connectGithub, switchGithubAccount } from '@/app/dashboard/pro/actions';
import type { AccessView } from '@/server/billing/pro-pages';
import type { LinkErrorCode } from '@/lib/link-errors';

const LINK_ERROR_TEXT: Record<LinkErrorCode, ReactNode> = {
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

interface Props {
  github: AccessView['github'];
  githubOrg: string;
  /** Why connecting GitHub failed, if it just did. */
  linkError?: LinkErrorCode;
}

/** The customer's GitHub connection, which grants access to the private package feed. */
export function GithubCard({ github, githubOrg, linkError }: Readonly<Props>) {
  return (
    <Card className={'p-6'}>
      <CardHeader className={'p-0'}>
        <CardTitle>GitHub access</CardTitle>
      </CardHeader>
      <CardContent className={'p-0 pt-4 flex flex-col gap-3'}>
        {linkError && (
          <p role={'alert'} className={'rounded-md bg-destructive-surface px-3 py-2 text-sm text-destructive'}>
            {LINK_ERROR_TEXT[linkError]}
          </p>
        )}
        {github.login ? (
          <>
            <p className={'text-muted-foreground'}>
              Connected as <span className={'font-medium text-foreground'}>@{github.login}</span>
            </p>
            <GithubStatus github={github} githubOrg={githubOrg} />
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
              signed in to. @{github.login} keeps access until the new account is connected.
            </p>
          </>
        ) : (
          <>
            <p className={'text-muted-foreground'}>
              Connect GitHub to get added to the <span className={'font-medium text-foreground'}>{githubOrg}</span> org,
              which grants access to the private Tenantry Pro package feed.
            </p>
            <p className={'text-sm text-muted-foreground'}>
              One GitHub account per subscription has access. For a team, connect an account you share, such as a
              machine account, and give its token to your developers and CI.
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
  );
}

function GithubStatus({ github, githubOrg }: Readonly<Omit<Props, 'linkError'>>) {
  if (github.state === 'active') {
    return (
      <p className={'text-sm text-muted-foreground'}>
        A member of the {githubOrg} org: you can restore Tenantry Pro packages from the private feed.
      </p>
    );
  }

  if (github.state === 'invited') {
    return (
      <div className={'flex flex-col gap-2 text-sm'}>
        <p className={'text-muted-foreground'}>
          GitHub has sent you an invitation to the {githubOrg} org. Accept it to restore Tenantry Pro packages
          {github.invitationExpiresAt
            ? ` (it lapses on ${formatDate(github.invitationExpiresAt)}, and we send a new one if it does)`
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

  if (github.state === 'failed') {
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

// Rendered on the server, so in one locale for everyone, as the billing card's dates are.
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
