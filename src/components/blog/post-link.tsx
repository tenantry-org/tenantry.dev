'use client';

import Link from 'fumadocs-core/link';
import type { ComponentProps } from 'react';
import { track } from '@vercel/analytics';

/**
 * A link in a post, as the docs render one, that records a Vercel Analytics event when it leads to the docs or to
 * Pro: which posts send readers on.
 */
export function PostLink({ post, href, onClick, ...props }: ComponentProps<typeof Link> & Readonly<{ post: string }>) {
  return (
    <Link
      {...props}
      href={href}
      onClick={(e) => {
        if (href && /^\/(docs|pro)(\/|$|#)/.test(href)) track('Blog link', { post, to: href });
        onClick?.(e);
      }}
    />
  );
}
