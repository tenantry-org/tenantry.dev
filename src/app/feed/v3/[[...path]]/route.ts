import { handleFeedRequest } from '@/server/feed/nuget-feed';
import { handlePublish } from '@/server/feed/publish';

// Tenantry Pro's NuGet feed (src/server/feed/nuget-feed.ts). Every answer depends on the request's credentials, so
// nothing here is prerendered or cached; package downloads are redirects to signed storage URLs, so no response
// carries a package.

interface Context {
  params: Promise<{ path?: string[] }>;
}

export async function GET(request: Request, { params }: Context) {
  return handleFeedRequest(request, (await params).path ?? []);
}

export async function HEAD(request: Request, { params }: Context) {
  const response = await handleFeedRequest(request, (await params).path ?? []);
  return new Response(null, { status: response.status, headers: response.headers });
}

export async function PUT(request: Request, { params }: Context) {
  const path = (await params).path ?? [];
  if (path.length !== 1 || path[0] !== 'package') return new Response('Not found.', { status: 404 });
  return handlePublish(request);
}
