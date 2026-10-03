import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CopyButton } from '@/components/dashboard/pro/copy-button';
import { Snippet } from '@/components/dashboard/pro/snippet';
import { DownloadButton } from '@/components/dashboard/pro/access/download-button';
import { LICENCE_CONFIG_KEY, LICENCE_ENV_VARIABLE, licenceUserSecret } from '@/lib/install-snippets';

/** The customer's licence key, and where Tenantry.Pro reads it from; null until it is issued. */
export function LicenceCard({ licenceKey }: Readonly<{ licenceKey: string | null }>) {
  return (
    <Card className={'p-6'}>
      <CardHeader className={'p-0'}>
        <CardTitle>Licence key</CardTitle>
      </CardHeader>
      <CardContent className={'p-0 pt-4 flex flex-col gap-3'}>
        {licenceKey ? (
          <>
            <p className={'text-sm text-muted-foreground'}>
              The key does not expire, and renewals keep it. Tenantry Pro reads it from the configuration key{' '}
              <code>{LICENCE_CONFIG_KEY}</code>, so keep it out of source control.
            </p>
            <code
              className={
                'block max-h-24 overflow-auto rounded-md border border-border bg-code p-3 font-mono text-xs break-all'
              }
            >
              {licenceKey}
            </code>
            <div className={'flex gap-2'}>
              <CopyButton value={licenceKey} label={'Copy key'} />
              <DownloadButton value={licenceKey} filename={'tenantry-pro.licence'} />
            </div>
            <p className={'text-sm text-muted-foreground'}>
              Locally, store it with user secrets, from your project&apos;s directory (they are read in the Development
              environment). In CI and other environments, set the environment variable{' '}
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
  );
}
