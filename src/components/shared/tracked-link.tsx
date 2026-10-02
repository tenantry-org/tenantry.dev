'use client';

import Link from 'next/link';
import type { ComponentProps } from 'react';
import { track } from '@vercel/analytics';

/**
 * A link that records a Vercel Analytics event when followed: the steps from the home page, the Pro page and the blog
 * towards the docs, Pro and its pricing.
 */
export function TrackedLink({
  event,
  data,
  onClick,
  ...props
}: ComponentProps<typeof Link> & Readonly<{ event: string; data?: Record<string, string> }>) {
  return (
    <Link
      {...props}
      onClick={(e) => {
        track(event, data);
        onClick?.(e);
      }}
    />
  );
}
