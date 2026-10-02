'use client';

import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Saves `value` as a file named `filename`. */
export function DownloadButton({ value, filename }: Readonly<{ value: string; filename: string }>) {
  return (
    <Button
      type={'button'}
      variant={'outline'}
      size={'sm'}
      onClick={() => {
        const blob = new Blob([value], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        URL.revokeObjectURL(url);
      }}
    >
      <Download className={'h-4 w-4'} /> Download
    </Button>
  );
}
