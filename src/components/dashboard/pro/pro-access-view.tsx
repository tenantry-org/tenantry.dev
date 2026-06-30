'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, Copy, Download, Github } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { connectGithub } from '@/app/dashboard/pro/actions';
import type { ProAccess } from '@/utils/entitlements/get-entitlement';

interface Props {
  access: ProAccess;
  githubOrg: string;
}

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

export function ProAccessView({ access, githubOrg }: Props) {
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
        <CardContent className={'p-0 pt-4'}>
          <p className={'text-secondary'}>
            Tier: <span className={'text-primary font-medium capitalize'}>{entitlement.tier}</span>
          </p>
        </CardContent>
      </Card>

      {/* GitHub connection */}
      <Card className={cardClass}>
        <CardHeader className={'p-0'}>
          <CardTitle>GitHub access</CardTitle>
        </CardHeader>
        <CardContent className={'p-0 pt-4 flex flex-col gap-3'}>
          {githubLogin ? (
            <>
              <p className={'text-secondary'}>
                Connected as <span className={'text-primary font-medium'}>@{githubLogin}</span>
              </p>
              <p className={'text-secondary text-sm'}>
                {entitlement.githubGranted
                  ? `Added to the ${githubOrg} org — you can restore Tenantry Pro packages from the private feed.`
                  : 'Link saved. Access is being provisioned — refresh in a moment.'}
              </p>
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
                Expires {new Date(licence.expiresAt).toLocaleDateString()}. Set it as <code>Tenantry:Licence</code> in
                your app configuration.
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
              No licence has been issued yet. It is generated automatically once your subscription is active.
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
