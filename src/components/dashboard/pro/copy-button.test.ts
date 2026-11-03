import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyToClipboard } from './copy-button';

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
