import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LegalPage } from './legal-page';

const entity = vi.hoisted(() => ({ incomplete: true }));

vi.mock('@/components/shared/simple-header', () => ({ SimpleHeader: () => null }));
vi.mock('@/components/home/footer/footer', () => ({ Footer: () => null }));
vi.mock('@/constants/legal-entity', () => ({ legalEntityIncomplete: () => entity.incomplete }));

const TEMPLATE_NOTE = 'This document is a template';

function render() {
  return renderToStaticMarkup(
    <LegalPage title={'Terms'} lastUpdated={'1 November 2026'}>
      <p>Body</p>
    </LegalPage>,
  );
}

describe('LegalPage', () => {
  beforeEach(() => {
    entity.incomplete = true;
  });

  it('says the document is a template while the legal entity has placeholders', () => {
    expect(render()).toContain(TEMPLATE_NOTE);
  });

  it('drops the template note once the legal entity is filled in', () => {
    entity.incomplete = false;

    expect(render()).not.toContain(TEMPLATE_NOTE);
  });
});
