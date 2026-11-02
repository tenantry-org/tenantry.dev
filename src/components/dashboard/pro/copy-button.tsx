'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Writes the text to the clipboard, and says whether it did. The browser can refuse (a denied permission, a page
 * without focus), and some of what is copied, such as a new feed token, is shown only once.
 */
export async function copyToClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function CopyButton({ value, label = 'Copy' }: Readonly<{ value: string; label?: string }>) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  return (
    <>
      <Button
        type={'button'}
        variant={'outline'}
        size={'sm'}
        onClick={async () => {
          if (await copyToClipboard(value)) {
            setState('copied');
            setTimeout(() => setState('idle'), 1500);
          } else {
            setState('failed');
          }
        }}
      >
        {state === 'copied' ? <Check className={'h-4 w-4'} /> : <Copy className={'h-4 w-4'} />}
        {state === 'copied' ? 'Copied' : label}
      </Button>
      {state === 'failed' && (
        <p role={'alert'} className={'text-sm leading-8 text-destructive'}>
          Copy failed: select the text and copy it.
        </p>
      )}
    </>
  );
}
