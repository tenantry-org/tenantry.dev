import { type NextRequest } from 'next/server';
import { updateSession } from '@/server/db/update-session';

// Next 16 renamed the `middleware` convention to `proxy` (same signature). Refreshes the Supabase auth session before
// the pages that read it render: a server component cannot write the refreshed cookies itself.
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Every path except:
     * - the docs and the API routes, which read no session (a signed-in reader would otherwise wait on Supabase Auth
     *   for every docs page), with their RSC payloads (`/docs.rsc`, `/docs.segments/…`);
     * - Next's static files and image optimisation, the favicon and images.
     * The home page (its header shows the account) and checkout are matched.
     */
    '/((?!(?:docs|api)(?:[/.]|$)|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
