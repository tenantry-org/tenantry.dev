import { describe, expect, it } from 'vitest';
import { sitePath } from './site-path';

describe('sitePath', () => {
  it('keeps a path on the site, with its query string', () => {
    expect(sitePath('/checkout/pri_01month')).toBe('/checkout/pri_01month');
    expect(sitePath('/dashboard/pro?tab=install')).toBe('/dashboard/pro?tab=install');
  });

  it.each([
    null,
    undefined,
    '',
    '//evil.example',
    '//',
    '/\\',
    '/\\evil.example',
    '/\t/evil.example',
    '/a/..//evil.example',
    '/.//evil.example',
    '/a/../\\evil.example',
    '@evil.example',
    '.evil.example',
    'https://evil.example/dashboard',
    'javascript:alert(1)',
  ])('refuses a next that is not a page on the site: %j', (next) => {
    expect(sitePath(next)).toBeNull();
  });
});
