import { CopyButton } from '@/components/dashboard/pro/copy-button';

/** A block of text to paste, with a button that copies it if it has a label. */
export function Snippet({ value, label }: Readonly<{ value: string; label?: string }>) {
  return (
    <div className={'flex flex-col gap-2'}>
      <code
        className={
          'block max-h-48 overflow-auto rounded-md border border-border bg-code p-3 font-mono text-xs whitespace-pre'
        }
      >
        {value}
      </code>
      {label && <CopyButton value={value} label={label} />}
    </div>
  );
}
