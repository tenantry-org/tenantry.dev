import type { ReactNode } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NoSubscription } from '@/components/dashboard/pro/no-subscription';
import { Snippet } from '@/components/dashboard/pro/snippet';
import { VESTED_RELEASES, VESTING_RULES } from '@/constants/vesting';
import type { InstallView, NoSubscriptionView } from '@/server/billing/pro-pages';
import {
  FEED_TOKEN_VARIABLE,
  LICENCE_ENV_VARIABLE,
  addProPackages,
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

          <Step title={'4. Add the packages'}>
            <p className={'text-sm text-muted-foreground'}>
              From your project&apos;s directory. Add <code>Tenantry.Pro.Hangfire</code>, <code>.Quartz</code>,{' '}
              <code>.MassTransit</code> or <code>.Rebus</code> for your job or message library. The application does not
              start without your licence key: the{' '}
              <Link className={'text-link underline underline-offset-4'} href={ACCESS_PAGE}>
                Access page
              </Link>{' '}
              shows it and how to store it.
            </p>
            <Snippet value={addProPackages} label={'Copy'} />
          </Step>

          <Step title={'5. Restore from a lock file'}>
            <p className={'text-sm text-muted-foreground'}>
              With this property in your Directory.Build.props, a restore writes packages.lock.json next to each
              project. Commit those files. In CI and Docker builds, restore in locked mode, which fails instead of
              taking a different version or a package whose content has changed.
            </p>
            <Snippet value={lockFileProperty} label={'Copy'} />
            <Snippet value={lockedRestore} />
            <p className={'text-sm text-muted-foreground'}>
              A restore that needs a Pro package not already in NuGet&apos;s global packages folder downloads it from
              the package feed, so it fails while the feed cannot be reached. With lock files, a restore downloads
              nothing from the feed when every package they name is already in that folder. The folder is{' '}
              <code>~/.nuget/packages</code> unless <code>NUGET_PACKAGES</code> names another; keep it between CI runs.
              NuGet&apos;s vulnerability audit still reads the feed and warns NU1900 when it cannot, which fails the
              restore when warnings are errors. The feed publishes no vulnerability data, so with the .NET 9 SDK or
              later (NuGet 6.12), an <code>auditSources</code> list in nuget.config that names only nuget.org stops the
              warning. The .NET 8 SDK ignores that list; there, add NU1900 to <code>WarningsNotAsErrors</code> in the
              project or Directory.Build.props, which keeps the warning without failing the restore.
            </p>
          </Step>

          <Step title={'6. CI'}>
            <p className={'text-sm text-muted-foreground'}>
              Store a feed token of its own and the licence key as secrets. In GitHub Actions:
            </p>
            <Snippet value={ciWorkflow} label={'Copy workflow'} />
            <p className={'text-sm text-muted-foreground'}>
              Other CI systems work the same way: <code>{FEED_TOKEN_VARIABLE}</code> for the restore, and{' '}
              <code>{LICENCE_ENV_VARIABLE}</code> for anything that starts the application.
            </p>
          </Step>

          <Step title={'7. Docker'}>
            <p className={'text-sm text-muted-foreground'}>
              Pass the feed token as a build secret rather than a build argument, so no image layer keeps it. Restore
              with nuget.config, your Directory.Build.props and Directory.Packages.props if you have them, and the
              project and lock files before copying the rest of the source:
            </p>
            <Snippet value={dockerRestore} label={'Copy'} />
            <Snippet value={dockerBuild} label={'Copy'} />
          </Step>

          <Step title={'Rotating feed tokens'}>
            <ul className={'flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground'}>
              <li>
                To replace a token, create a new one, update the environment variable or CI secret, then revoke the old
                one on the Access page. Your other tokens keep working.
              </li>
              <li>If a token may have leaked, revoke it straight away, then create another.</li>
              <li>The licence key never needs rotating.</li>
            </ul>
          </Step>

          <Step title={'After the subscription ends'}>
            <p className={'text-sm text-muted-foreground'}>
              Your feed tokens keep working, and the package feed serves you only the vested releases: {VESTED_RELEASES}
              . If nothing is vested, it serves you nothing. A version the feed no longer serves you is left out of its
              version lists, so a restore of a range such as <code>0.*</code> takes the newest vested release.{' '}
              <Link className={'text-link underline underline-offset-4'} href={VESTING_RULES}>
                How vesting works
              </Link>
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
