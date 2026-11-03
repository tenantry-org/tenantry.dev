import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyButton, copyToClipboard } from './copy-button';

// The tests run in Node with no DOM to click in, so the copy's state is set here.
const copyState = vi.hoisted(() => ({ value: 'idle' }));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: () => [copyState.value, () => undefined],
}));

const clipboard = (writeText: (value: string) => Promise<void>) =>
  vi.stubGlobal('navigator', { clipboard: { writeText } });

describe('copyToClipboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('copies the text and says so', async () => {
    const writeText = vi.fn(async () => undefined);
    clipboard(writeText);

    await expect(copyToClipboard('feed-token')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('feed-token');
  });

  it('says the copy failed when the browser refuses it, rather than throwing', async () => {
    clipboard(async () => {
      throw new DOMException('Write permission denied.', 'NotAllowedError');
    });

    await expect(copyToClipboard('feed-token')).resolves.toBe(false);
  });

  it('says the copy failed when the page has no clipboard, as on a page not served over HTTPS', async () => {
    vi.stubGlobal('navigator', {});

    await expect(copyToClipboard('feed-token')).resolves.toBe(false);
  });
});

describe('CopyButton', () => {
  afterEach(() => {
    copyState.value = 'idle';
  });

  it('puts the failure message under its row of buttons, not between them', () => {
    copyState.value = 'failed';

    const html = renderToStaticMarkup(
      <CopyButton value={'feed-token'} label={'Copy token'}>
        <button type={'button'}>Done</button>
      </CopyButton>,
    );

    expect(html).toMatch(
      /^<div class="flex gap-2"><button [^>]*>.*Copy token<\/button><button type="button">Done<\/button><\/div><p role="alert"[^>]*>Copy failed/,
    );
  });

  it('shows no message until a copy fails', () => {
    const html = renderToStaticMarkup(<CopyButton value={'feed-token'} label={'Copy token'} />);

    expect(html).not.toContain('role="alert"');
  });
});
