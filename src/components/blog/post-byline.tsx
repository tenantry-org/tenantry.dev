import { formatDate, type Post } from '@/lib/blog';

// The author and dates, above a post's title on the index and on its page.
export function PostByline({ post }: Readonly<{ post: Post }>) {
  return (
    <p className={'flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground'}>
      {post.draft && (
        <span className={'rounded-full bg-warning-surface px-2 py-0.5 text-xs font-medium text-warning'}>Draft</span>
      )}
      <span>{post.author}</span>
      <span aria-hidden={true}>·</span>
      <time dateTime={post.date}>{formatDate(post.date)}</time>
      {post.updated && (
        <>
          <span aria-hidden={true}>·</span>
          <span>
            Updated <time dateTime={post.updated}>{formatDate(post.updated)}</time>
          </span>
        </>
      )}
    </p>
  );
}
