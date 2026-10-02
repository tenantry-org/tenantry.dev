import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AccessView } from '@/server/billing/pro-pages';
import { LINK_ERROR_CODES, type LinkErrorCode } from '@/lib/link-errors';
import { AccessPanel } from './access-panel';

vi.mock('@/app/dashboard/pro/actions', () => ({ connectGithub: vi.fn(), switchGithubAccount: vi.fn() }));

const view: AccessView = {
  noSubscription: false,
  github: { login: 'octocat', state: 'invited', invitationExpiresAt: '2026-10-25T09:00:00.000Z' },
  licenceKey: 'licence.key',
};

const render = (linkError?: LinkErrorCode) =>
  renderToStaticMarkup(<AccessPanel view={view} githubOrg={'tenantry-customers'} linkError={linkError} />);

describe('AccessPanel', () => {
  it('shows the GitHub connection and the licence key', () => {
    const html = render();

    expect(html).toContain('@octocat');
    expect(html).toContain('it lapses on 25 October 2026');
    expect(html).toContain('licence.key');
    expect(html).not.toContain('role="alert"');
  });

  it.each(LINK_ERROR_CODES)('explains why connecting GitHub failed: %s', (code) => {
    expect(render(code)).toMatch(/role="alert"[^>]*>[^<]+/);
  });

  it('points a former customer to billing', () => {
    const html = renderToStaticMarkup(
      <AccessPanel
        view={{ noSubscription: true, customer: true, accountEmail: null }}
        githubOrg={'tenantry-customers'}
      />,
    );

    expect(html).toContain('No active Tenantry Pro subscription');
    expect(html).toContain('/dashboard/pro/billing');
    expect(html).not.toContain('licence.key');
  });
});
