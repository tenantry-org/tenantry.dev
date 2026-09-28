/**
 * Runs once when a server instance starts. It validates the configuration, so a missing or unsafe setting
 * stops the server rather than surfacing later as a silent default (see utils/config/server-config.ts).
 * The build does not validate: the configuration belongs to the environment the build is deployed to.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return;

  const { validateServerConfig } = await import('@/utils/config/server-config');
  validateServerConfig();
}
