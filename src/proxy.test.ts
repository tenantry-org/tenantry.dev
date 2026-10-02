import { describe, expect, it, vi } from 'vitest';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { config } from './proxy';

vi.mock('@/server/db/update-session', () => ({ updateSession: vi.fn() }));

const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });

describe('the proxy', () => {
  it.each([
    '/',
    '/checkout/pri_01',
    '/checkout/success',
    '/dashboard/pro',
    '/dashboard/pro/billing',
    '/login',
    '/signup',
    '/reset-password',
    '/auth/callback?code=c',
    '/legal/terms',
    '/pay',
    '/dashboard/pro.rsc',
    '/dashboard/pro.segments/_tree.segment.rsc',
  ])('refreshes the session for %s', (url) => {
    expect(matches(url)).toBe(true);
  });

  it.each([
    '/docs',
    '/docs/pro/installation',
    '/docs/v0.4/core',
    '/docs.rsc',
    '/docs.segments/_tree.segment.rsc',
    '/docs/pro/installation.rsc',
    '/api/webhook',
    '/api/search?query=tenant',
    '/api/reconcile',
    '/_next/static/chunks/main.js',
    '/favicon.ico',
    '/icon.svg',
  ])('leaves %s alone', (url) => {
    expect(matches(url)).toBe(false);
  });

  it('leaves out whole path segments only', () => {
    expect(matches('/docs-archive')).toBe(true);
    expect(matches('/apis')).toBe(true);
  });
});
