import { SITE_ORIGIN } from '@/constants/site';

// The blog's Markdown and date helpers, apart from blog.ts so they can be tested without compiling the posts.

/** What a post's copy elsewhere shows besides its Markdown. */
export interface CrossPostDetails {
  versions: string;
  next: { label: string; href: string };
}

/** A site path or URL as an absolute URL on the production site. */
export function absoluteUrl(href: string): string {
  return new URL(href, SITE_ORIGIN).toString();
}

/** A date written YYYY-MM-DD as the posts show it: 3 October 2026. */
export function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * A post's Markdown for its copy elsewhere (dev.to): the releases it was checked against first and its next step
 * last, as its page shows them, and every site path made absolute.
 */
export function crossPostMarkdown(post: CrossPostDetails, markdown: string): string {
  return [
    `*Checked against ${post.versions}.*`,
    withAbsoluteLinks(markdown.trim()),
    `**[${post.next.label}](${absoluteUrl(post.next.href)})**`,
  ].join('\n\n');
}

/** Markdown with the site paths of its links, images and link definitions made absolute URLs. */
export function withAbsoluteLinks(markdown: string): string {
  let inFence = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
      if (inFence) return line;
      return line
        .replace(/(\]\()(\/[^)\s]*)/g, (_, open: string, path: string) => `${open}${absoluteUrl(path)}`)
        .replace(/^(\s*\[[^\]]+\]:\s*)(\/\S*)/, (_, label: string, path: string) => `${label}${absoluteUrl(path)}`);
    })
    .join('\n');
}
