'use client';

import { type ReactNode, useState } from 'react';
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

/**
 * A button that copies the value, with any other buttons for its row as children. When the copy fails, the message
 * follows the row instead of sitting in it, so in a column it goes under the buttons, not between them where it would
 * wrap on a phone.
 */
export function CopyButton({
  value,
  label = 'Copy',
  children,
}: Readonly<{ value: string; label?: string; children?: ReactNode }>) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const button = (
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
  );

  return (
    <>
      {children ? (
        <div className={'flex gap-2'}>
          {button}
          {children}
        </div>
      ) : (
        button
      )}
      {state === 'failed' && (
        <p role={'alert'} className={'text-sm text-destructive'}>
          Copy failed: select the text and copy it.
        </p>
      )}
    </>
  );
}
