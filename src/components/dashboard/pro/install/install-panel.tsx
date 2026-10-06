import type { ReactNode } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NoSubscription } from '@/components/dashboard/pro/no-subscription';
import { Snippet } from '@/components/dashboard/pro/snippet';
import type { InstallView, NoSubscriptionView } from '@/server/billing/pro-pages';
import {
  FEED_TOKEN_VARIABLE,
  LICENCE_ENV_VARIABLE,
  ciWorkflow,
  dockerBuild,
  dockerRestore,
  feedTokenPowerShell,
  feedTokenShell,
  feedUrl,
  lockFileProperty,
  lockedRestore,
  nugetConfig,
} from '@/lib/install-snippets';

const INSTALL_GUIDE = '/docs/pro/installation';
const ACCESS_PAGE = '/dashboard/pro';

/**
 * Install (/dashboard/pro/install): restoring Tenantry Pro from this deployment's package feed (`siteUrl`), on a
 * developer machine, in CI and in a Docker build.
 */
export function InstallPanel({ view, siteUrl }: Readonly<{ view: InstallView | NoSubscriptionView; siteUrl: string }>) {
  if (view.noSubscription) return <NoSubscription view={view} />;

  return (
    <div className={'max-w-4xl'}>
      <Card className={'p-6'}>
        <CardHeader className={'p-0'}>
          <CardTitle>Install the packages</CardTitle>
        </CardHeader>
        <CardContent className={'p-0 pt-4 flex flex-col gap-4'}>
          <p className={'text-sm text-muted-foreground'}>
            Tenantry Pro&apos;s packages come from the package feed at <code>{feedUrl(siteUrl)}</code>. Tenantry Core
            and everything else stay on nuget.org. The{' '}
            <Link className={'text-link underline underline-offset-4'} href={INSTALL_GUIDE}>
              installation guide
            </Link>{' '}
            explains each step in more detail, with troubleshooting.
          </p>

          <Step title={'1. Create a feed token'}>
            <p className={'text-sm text-muted-foreground'}>
              Create one on the{' '}
              <Link className={'text-link underline underline-offset-4'} href={ACCESS_PAGE}>
                Access page
              </Link>
              , for example one for each developer machine and CI system, named after where it is used, so you can
              revoke one without affecting the others. The token is shown once, when you create it.
            </p>
          </Step>

          <Step title={'2. Add this nuget.config next to your solution'}>
            <p className={'text-sm text-muted-foreground'}>
              Commit it: it holds no secrets. NuGet restores <code>Tenantry.Pro</code> and <code>Tenantry.Pro.*</code>{' '}
              from the package feed and everything else from nuget.org, and sends the feed token from the{' '}
              <code>{FEED_TOKEN_VARIABLE}</code> environment variable. If your solution has a nuget.config already, add
              these entries to it, and map any other source you use as well.
            </p>
            <Snippet value={nugetConfig(siteUrl)} label={'Copy nuget.config'} />
          </Step>

          <Step title={'3. Set the feed token on your machine'}>
            <p className={'text-sm text-muted-foreground'}>
              On macOS or Linux, in your shell profile. On Windows, in your user environment. Then restart your terminal
              and IDE.
            </p>
            <Snippet value={feedTokenShell} label={'Copy'} />
            <Snippet value={feedTokenPowerShell} label={'Copy'} />
          </Step>

          <Step title={'4. Restore from a lock file'}>
            <p className={'text-sm text-muted-foreground'}>
              With this property in your Directory.Build.props, a restore writes packages.lock.json next to each
              project. Commit those files. In CI and Docker builds, restore in locked mode, which fails instead of
              taking a different version or a package whose content has changed.
            </p>
            <Snippet value={lockFileProperty} label={'Copy'} />
            <Snippet value={lockedRestore} />
          </Step>

          <Step title={'5. CI'}>
            <p className={'text-sm text-muted-foreground'}>
              Store a feed token of its own and the licence key as secrets. In GitHub Actions:
            </p>
            <Snippet value={ciWorkflow} label={'Copy workflow'} />
            <p className={'text-sm text-muted-foreground'}>
              Other CI systems work the same way: <code>{FEED_TOKEN_VARIABLE}</code> for the restore, and{' '}
              <code>{LICENCE_ENV_VARIABLE}</code> for anything that starts the application.
            </p>
          </Step>

          <Step title={'6. Docker'}>
            <p className={'text-sm text-muted-foreground'}>
              Pass the feed token as a build secret rather than a build argument, so no image layer keeps it. Restore
              with nuget.config, your Directory.Build.props and Directory.Packages.props, and the project and lock files
              before copying the rest of the source:
            </p>
            <Snippet value={dockerRestore} label={'Copy'} />
            <Snippet value={dockerBuild} label={'Copy'} />
          </Step>

          <Step title={'Rotating feed tokens'}>
            <ul className={'flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground'}>
              <li>
                To replace a token, create a new one, update the environment variable or CI secret, then revoke the old
                one on the Access page. Its other tokens keep working.
              </li>
              <li>If a token may have leaked, revoke it straight away, then create another.</li>
              <li>The licence key never needs rotating.</li>
            </ul>
          </Step>

          <Step title={'After the subscription ends'}>
            <p className={'text-sm text-muted-foreground'}>
              Your feed tokens keep working, and the package feed serves you only the vested releases: those published
              on or before your vested-through date, and every patch release of a minor version whose x.y.0 release is
              vested. If nothing is vested, it serves you nothing. A version the feed no longer serves you is left out
              of its version lists, so a restore of a range such as <code>0.*</code> takes the newest vested release.
            </p>
          </Step>
        </CardContent>
      </Card>
    </div>
  );
}

function Step({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <div className={'flex flex-col gap-2'}>
      <h3 className={'text-sm font-semibold'}>{title}</h3>
      {children}
    </div>
  );
}
