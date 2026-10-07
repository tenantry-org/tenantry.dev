import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PageError from './error';

describe('PageError', () => {
  it('says the page could not load and offers to try again', () => {
    const html = renderToStaticMarkup(<PageError retry={() => undefined} />);

    expect(html).toContain('This page could not load');
    expect(html).toContain('Try again</button>');
  });
});
