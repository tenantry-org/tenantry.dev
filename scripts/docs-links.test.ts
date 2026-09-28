import { describe, expect, it } from 'vitest';
import { rewriteLinks } from './docs-links.mjs';

describe('rewriteLinks', () => {
  it('turns links between pages into absolute paths in the same docs group', () => {
    expect(rewriteLinks('See [stores](tenant-stores.md) and [ordering](pipeline.md#pipeline-ordering).', 'core')).toBe(
      'See [stores](/docs/core/tenant-stores) and [ordering](/docs/core/pipeline#pipeline-ordering).',
    );
    expect(rewriteLinks('[start](./getting-started.md)', 'pro')).toBe('[start](/docs/pro/getting-started)');
  });

  it("points README at the group's landing page", () => {
    expect(rewriteLinks('[overview](README.md)', 'pro')).toBe('[overview](/docs/pro)');
  });

  it("maps links to Core's docs on GitHub onto the site's Core docs", () => {
    expect(
      rewriteLinks('[hosts](https://github.com/tenantry-org/tenantry-core/blob/main/docs/non-http-hosts.md)', 'pro'),
    ).toBe('[hosts](/docs/core/non-http-hosts)');
  });

  it('leaves other absolute URLs and links outside the docs folder alone', () => {
    const untouched = '[spec](https://example.com/spec.md) [sample](../samples/TenantLifecycle) [x](../other/x.md)';
    expect(rewriteLinks(untouched, 'core')).toBe(untouched);
  });
});
