import { describe, expect, it } from 'vitest';
import { guideIndex, pageDescription } from './docs-description.mjs';

const lines = (text: string) => text.split('\n');

describe('pageDescription', () => {
  it("is the first paragraph's first sentence, with a link's text and the prose's parentheses", () => {
    expect(
      pageDescription(
        lines(
          '\nA tenant store answers which tenants exist (see [Suspended tenants](#suspended)), and `ITenantStore`\n' +
            'is **its** interface. More follows.\n\nNext paragraph.',
        ),
      ),
    ).toBe('A tenant store answers which tenants exist (see Suspended tenants), and ITenantStore is its interface.');
  });

  it('does not end a sentence at e.g. or i.e.', () => {
    expect(pageDescription(lines('Resolves the tenant from a request header (e.g. `X-Tenant`). Extra.'))).toBe(
      'Resolves the tenant from a request header (e.g. X-Tenant).',
    );
    expect(pageDescription(lines('Each gets a schema (i.e. its own tables). Extra.'))).toBe(
      'Each gets a schema (i.e. its own tables).',
    );
  });

  it('ends a sentence that introduces what follows with a full stop', () => {
    expect(pageDescription(lines('Resolution turns an HTTP request into a tenant, in two steps:\n\n1. Read it.'))).toBe(
      'Resolution turns an HTTP request into a tenant, in two steps.',
    );
  });

  it("skips an API page's namespace line and headings", () => {
    expect(
      pageDescription(lines('Namespace: Tenantry · Package: Tenantry.Core\n\n## Definition\n\nReads tenants.')),
    ).toBe('Reads tenants.');
  });
});

describe('guideIndex', () => {
  const readme = [
    '# Tenantry documentation',
    '',
    'Start with [Getting started](getting-started.md).',
    '',
    '### Foundations',
    '1. [Getting started](getting-started.md): install the packages and build an app end to end.',
    '2. [Access control](access-control.md): requiring tenants per endpoint, and `IsolateOutputCache()`.',
    '3. [Tenant lifecycle](tenant-lifecycle.md): provisioning a tenant (create, migrate) and',
    '   offboarding one',
    '',
    '### Background work',
    '4. [Hangfire](hangfire.md), [Rebus](rebus.md#setup): the tenant in each library.',
    '5. [API reference](api/README.md): every public type.',
    '6. [Elsewhere](https://example.com/guide.md): another site.',
    '',
    'An agent reads [Getting started](getting-started.md) first.',
  ].join('\n');

  it('lists the guides in the order the numbered list gives them, leaving out subfolders and other sites', () => {
    expect(guideIndex(readme).order).toEqual([
      'getting-started',
      'access-control',
      'tenant-lifecycle',
      'hangfire',
      'rebus',
    ]);
  });

  it("describes a guide by its item's text, as a sentence, joining a wrapped item's lines", () => {
    expect(Object.fromEntries(guideIndex(readme).descriptions)).toEqual({
      'getting-started': 'Install the packages and build an app end to end.',
      'access-control': 'Requiring tenants per endpoint, and IsolateOutputCache().',
      'tenant-lifecycle': 'Provisioning a tenant (create, migrate) and offboarding one.',
    });
  });

  it('has nothing for a folder without an index', () => {
    expect(guideIndex('')).toEqual({ order: [], descriptions: new Map() });
  });
});
