import { handleFeedRequest, serveFeed } from '@/server/feed/nuget-feed';
import { handlePublish } from '@/server/feed/publish';

// Tenantry Pro's NuGet feed (src/server/feed/nuget-feed.ts). Every answer depends on the request's credentials, so
// nothing here is prerendered or cached, and serveFeed marks every answer, a failure included, private; package
// downloads are redirects to signed storage URLs, so no response carries a package.

interface Context {
  params: Promise<{ path?: string[] }>;
}

export function GET(request: Request, { params }: Context) {
  return serveFeed(async () => handleFeedRequest(request, (await params).path ?? []));
}

export function HEAD(request: Request, { params }: Context) {
  return serveFeed(async () => {
    const response = await handleFeedRequest(request, (await params).path ?? []);
    return new Response(null, { status: response.status, headers: response.headers });
  });
}

export function PUT(request: Request, { params }: Context) {
  return serveFeed(async () => {
    const path = (await params).path ?? [];
    if (path.length !== 1 || path[0] !== 'package') return new Response('Not found.', { status: 404 });
    return handlePublish(request);
  });
}
