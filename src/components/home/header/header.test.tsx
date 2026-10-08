import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import Header from './header';

vi.mock('./account-button', () => ({ AccountButton: () => null }));

describe('Header', () => {
  it('links Docs and Pro on a phone, where the nav is hidden', () => {
    const phoneLinks = [...renderToStaticMarkup(<Header />).matchAll(/<a class="[^"]*md:hidden"[^>]*href="([^"]+)"/g)];

    expect(phoneLinks.map((match) => match[1])).toEqual(['/docs', '/pro']);
  });
});
