import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NoSubscription } from '@/components/dashboard/pro/no-subscription';
import { Snippet } from '@/components/dashboard/pro/snippet';
import type { InstallView, NoSubscriptionView } from '@/server/billing/pro-pages';
import {
  CREATE_TOKEN_URL,
  FEED_TOKEN_VARIABLE,
  FEED_USERNAME_VARIABLE,
  LICENCE_ENV_VARIABLE,
  ciWorkflow,
  feedCredentials,
  nugetConfig,
} from '@/lib/install-snippets';

const INSTALL_GUIDE = '/docs/pro/installation';

/** Install (/dashboard/pro/install): setting up the private package feed, locally and in CI. */
export function InstallPanel({
  view,
  githubOrg,
}: Readonly<{ view: InstallView | NoSubscriptionView; githubOrg: string }>) {
  if (view.noSubscription) return <NoSubscription view={view} />;
  const { githubLogin } = view;

  return (
    <div className={'max-w-4xl'}>
      <Card className={'p-6'}>
        <CardHeader className={'p-0'}>
          <CardTitle>Install the packages</CardTitle>
        </CardHeader>
        <CardContent className={'p-0 pt-4 flex flex-col gap-4'}>
          <p className={'text-sm text-muted-foreground'}>
            Tenantry Pro&apos;s packages are on a private GitHub Packages feed; Tenantry Core and everything else stay
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
