/**
 * A docs page's description when the docs folder's index gives none (guideIndex): the first sentence of its first
 * paragraph (`body` is its lines without the title). It is the page's meta description and its line in llms.txt, so
 * it ends at a sentence rather than mid-word. A link or image keeps only its text, code and emphasis marks are
 * dropped, and the prose keeps its parentheses. A sentence does not end at "e.g." or "i.e.", and one that ends in a
 * colon, introducing what follows on the page, ends in a full stop.
 *
 * @param {string[]} body
 */
export function pageDescription(body) {
  const firstParagraph = [];
  for (const line of body) {
    const text = line.trim();
    if (!text) {
      if (firstParagraph.length) break;
      continue;
    }
    // API reference pages open with a "Namespace: … · Package: …" line, which is not a description.
    if (/^(#|```|\||-|Namespace:)/.test(text)) {
      if (firstParagraph.length) break;
      continue;
    }
    firstParagraph.push(text);
  }
  const cleaned = plainText(firstParagraph.join(' '));
  return (cleaned.match(/^.*?(?<!\b(?:e\.g|i\.e))\.(?:\s|$)/)?.[0] ?? cleaned).trim().replace(/:$/, '.');
}

/**
 * The guides a docs folder's index (its README.md) lists, from its numbered list, where each item links one guide or
 * several and may wrap onto indented lines: `order`, the guides' slugs as listed, and `descriptions`, each guide's text
 * after its link and colon for an item that links only that guide. That text is written to say what the page covers,
 * so it is a better description than the page's first sentence, which can state a problem the page then solves. Only
 * pages in the same folder count: a link into a subfolder (api/README.md) or to another site is left out.
 *
 * @param {string} readme
 * @returns {{ order: string[], descriptions: Map<string, string> }}
 */
export function guideIndex(readme) {
  const items = [];
  let inItem = false;
  for (const line of readme.split('\n')) {
    if (/^\d+\.\s/.test(line)) {
      items.push(line.replace(/^\d+\.\s+/, ''));
      inItem = true;
    } else if (inItem && /^\s+\S/.test(line)) {
      items[items.length - 1] += ` ${line.trim()}`;
    } else {
      inItem = false;
    }
  }

  const order = [];
  const descriptions = new Map();
  for (const item of items) {
    const slugs = [...item.matchAll(/\[[^\]]*\]\(([\w.-]+)\.md(?:#[^)]*)?\)/g)].map(([, slug]) => slug);
    for (const slug of slugs) if (!order.includes(slug)) order.push(slug);

    const described = item.match(/^\[[^\]]*\]\(([\w.-]+)\.md\):\s*(.+)$/);
    if (described && slugs.length === 1 && !descriptions.has(described[1])) {
      const text = plainText(described[2]);
      descriptions.set(described[1], `${text.charAt(0).toUpperCase()}${text.slice(1)}`.replace(/[^.]$/, '$&.'));
    }
  }
  return { order, descriptions };
}

// Markdown as plain text: a link or image keeps only its text, and code and emphasis marks are dropped.
function plainText(markdown) {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
