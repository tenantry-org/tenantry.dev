import type { Metadata } from 'next';
import Link from 'next/link';
import { PostByline } from '@/components/blog/post-byline';
import { postsWithPages } from '@/lib/blog';

export const metadata: Metadata = {
  title: 'Blog — Tenantry',
  description: 'Articles on multi-tenancy in .NET: tenant isolation in EF Core, tenant databases and their operations.',
  alternates: { canonical: '/blog', types: { 'application/rss+xml': '/blog/rss.xml' } },
};

export default function BlogIndex() {
  const posts = postsWithPages();

  return (
    <div className={'mx-auto max-w-3xl px-4 py-16 md:px-8 md:py-20'}>
      <h1 className={'text-3xl font-bold tracking-tight md:text-4xl'}>Blog</h1>
      {posts.length === 0 ? (
        <p className={'mt-8 text-muted-foreground'}>No posts yet.</p>
      ) : (
        <ul className={'mt-10 flex flex-col divide-y divide-border/70'}>
          {posts.map((post) => (
            <li key={post.slug} className={'py-8 first:pt-0'}>
              <PostByline post={post} />
              <h2 className={'mt-2 text-xl font-semibold'}>
                <Link href={post.url} className={'hover:text-link'}>
                  {post.title}
                </Link>
              </h2>
              <p className={'mt-2 text-muted-foreground'}>{post.description}</p>
            </li>
          ))}
        </ul>
      )}
      <p className={'mt-12 text-sm text-muted-foreground'}>
        <Link href={'/blog/rss.xml'} className={'text-link hover:underline'}>
          RSS feed
        </Link>
      </p>
    </div>
  );
}
