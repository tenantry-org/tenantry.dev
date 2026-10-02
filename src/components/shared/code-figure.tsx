import { highlight } from 'fumadocs-core/highlight';

// Highlighted once per snippet and cached: highlighting reads the clock (Date.now()), which prerendering refuses
// otherwise.
async function highlighted(code: string) {
  'use cache';
  return highlight(code, { lang: 'csharp', theme: 'github-dark-default' });
}

/** A C# snippet in the site's code frame, with its file name above it. */
export async function CodeFigure({ code, caption }: Readonly<{ code: string; caption: string }>) {
  const html = await highlighted(code);

  return (
    <figure
      className={
        'min-w-0 overflow-hidden rounded-xl border border-border bg-code shadow-[0_24px_48px_-24px_rgb(0_0_0/0.6)]'
      }
    >
      <figcaption className={'border-b border-border px-4 py-2.5 text-xs text-muted-foreground'}>
        <span className={'font-mono'}>{caption}</span>
      </figcaption>
      <div
        className={
          'overflow-x-auto py-4 font-mono text-[13px] leading-6 [font-variant-ligatures:none] [&_pre]:bg-transparent!'
        }
      >
        {html}
      </div>
    </figure>
  );
}
