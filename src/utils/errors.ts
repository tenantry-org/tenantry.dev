/**
 * The message of a thrown value. Supabase reports errors as plain `{ code, message }` objects rather than
 * `Error` instances, so `String(error)` would give "[object Object]".
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}
