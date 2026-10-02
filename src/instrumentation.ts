/**
 * Runs once when a server instance starts. It validates the server's configuration, so a missing or unsafe setting
 * stops the server rather than surfacing later as a silent default (see server/config/server-config.ts). The build
 * does not validate it: it belongs to the environment the build is deployed to. The build checks only the public
 * configuration, which it compiles in (lib/public-config.ts).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return;

  const { serverConfig } = await import('@/server/config/server-config');
  serverConfig();
}
