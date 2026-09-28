/**
 * Reads a required environment variable. There are no defaults: the server's configuration is validated
 * at startup (see `server-config.ts`), and anything read here without a value fails rather than falling
 * back to a value that may belong to another environment.
 */
export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
}
