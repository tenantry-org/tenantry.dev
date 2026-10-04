import { describe, expect, it } from 'vitest';
import { pageDescription } from './docs-description.mjs';

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
