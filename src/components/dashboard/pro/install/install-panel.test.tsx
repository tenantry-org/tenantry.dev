import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ENTITLEMENT } from '@/test/entitlement-views';
import { InstallPanel } from './install-panel';

const render = () =>
  renderToStaticMarkup(
    <InstallPanel view={{ noSubscription: false, entitlement: ENTITLEMENT.active }} siteUrl={'https://tenantry.dev'} />,
  );

describe('InstallPanel', () => {
  it('says which packages to add, and points to the Access page for the licence key', () => {
    const html = render();

    expect(html).toContain('4. Add the packages');
    expect(html).toContain('dotnet add package Tenantry.Pro\ndotnet add package Tenantry.Pro.EfCore');
    expect(html).toMatch(
      /does not start without your licence key: the <a [^>]*href="\/dashboard\/pro"[^>]*>Access page/,
    );
    expect(html).not.toContain('dotnet user-secrets');
  });

  it('says what a restore needs while the package feed is unreachable', () => {
    const html = render();

    expect(html).toContain('so it fails while the feed cannot be reached');
    expect(html).toContain('<code>NUGET_PACKAGES</code> names another; keep it between CI runs');
    expect(html).toContain('warns NU1900 when it cannot');
  });

  it('numbers the steps in order', () => {
    const steps = [...render().matchAll(/<h3[^>]*>(\d+)\. /g)].map((match) => Number(match[1]));

    expect(steps).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
