'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function CopyButton({ value, label = 'Copy' }: Readonly<{ value: string; label?: string }>) {
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
