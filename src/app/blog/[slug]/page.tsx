import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { PostByline } from '@/components/blog/post-byline';
import { getMDXComponents } from '@/mdx-components';
import { getPost, postsWithPages } from '@/lib/blog';

// A slug no post has: Cache Components needs at least one prerendered page, and a build may have no posts yet.
const NO_POSTS = '-';

export function generateStaticParams() {
  const slugs = postsWithPages().map((post) => ({ slug: post.slug }));
  return slugs.length > 0 ? slugs : [{ slug: NO_POSTS }];
}

export default async function PostPage(props: Readonly<{ params: Promise<{ slug: string }> }>) {
  const post = getPost((await props.params).slug);
  if (!post) notFound();

  const MDX = post.body;

  return (
    <article className={'mx-auto max-w-3xl px-4 py-16 md:px-8 md:py-20'}>
      <Link
        href={'/blog'}
        className={
          'inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground'
        }
      >
        <ArrowLeft className={'h-3.5 w-3.5'} aria-hidden={true} /> Blog
      </Link>
      <header className={'mt-8'}>
        <PostByline post={post} />
        <h1 className={'mt-3 text-3xl font-bold tracking-tight text-balance md:text-4xl'}>{post.title}</h1>
        <p className={'mt-4 text-lg text-muted-foreground'}>{post.description}</p>
        <p className={'mt-4 text-sm text-muted-foreground'}>Checked against {post.versions}.</p>
      </header>
      <div className={'prose mt-10 max-w-none'}>
        <MDX components={getMDXComponents()} />
      </div>
      <aside className={'mt-14 rounded-xl border border-border bg-card p-6'}>
        <Link
          href={post.next.href}
          className={'inline-flex items-center gap-1.5 font-semibold text-link hover:underline'}
        >
          {post.next.label} <ArrowRight className={'h-4 w-4'} aria-hidden={true} />
        </Link>
      </aside>
    </article>
  );
}

export async function generateMetadata(props: Readonly<{ params: Promise<{ slug: string }> }>): Promise<Metadata> {
  const post = getPost((await props.params).slug);
  if (!post) notFound();

  return {
    title: `${post.title} — Tenantry`,
    description: post.description,
    authors: [{ name: post.author }],
    alternates: { canonical: post.url },
    openGraph: {
      type: 'article',
      url: post.url,
      title: post.title,
      description: post.description,
      publishedTime: post.date,
      modifiedTime: post.updated,
      authors: [post.author],
      tags: post.tags,
    },
    robots: post.draft ? { index: false, follow: false } : undefined,
  };
}
