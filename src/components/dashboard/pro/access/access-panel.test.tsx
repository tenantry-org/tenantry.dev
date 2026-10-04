import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AccessView } from '@/server/billing/pro-pages';
import { AccessPanel } from './access-panel';

const view: AccessView = { noSubscription: false, licenceKey: 'licence.key' };

describe('AccessPanel', () => {
  it('shows the licence key, and nothing about GitHub', () => {
    const html = renderToStaticMarkup(<AccessPanel view={view} />);

    expect(html).toContain('licence.key');
    expect(html).not.toMatch(/github/i);
  });

  it('points a former customer to billing', () => {
    const html = renderToStaticMarkup(
      <AccessPanel view={{ noSubscription: true, customer: true, accountEmail: null, licenceKey: null }} />,
    );

    expect(html).toContain('No active Tenantry Pro subscription');
    expect(html).toContain('/dashboard/pro/billing');
    expect(html).not.toContain('Licence key');
  });

  it('still shows a former customer their licence key, which they keep', () => {
    const html = renderToStaticMarkup(
      <AccessPanel
        view={{ noSubscription: true, customer: true, accountEmail: null, licenceKey: 'kept.licence.key' }}
      />,
    );

    expect(html).toContain('No active Tenantry Pro subscription');
    expect(html).toContain('kept.licence.key');
  });
});
