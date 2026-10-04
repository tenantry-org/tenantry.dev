/**
 * A docs page's description, from the first sentence of its first paragraph (`body` is its lines without the title):
 * the page's meta description and its line in llms.txt, so it ends at a sentence rather than mid-word. A link or image
 * keeps only its text, code and emphasis marks are dropped, and the prose keeps its parentheses. A sentence does not
 * end at "e.g." or "i.e.", and one that ends in a colon, introducing what follows on the page, ends in a full stop.
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
  const cleaned = firstParagraph
    .join(' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned.match(/^.*?(?<!\b(?:e\.g|i\.e))\.(?:\s|$)/)?.[0] ?? cleaned).trim().replace(/:$/, '.');
}
