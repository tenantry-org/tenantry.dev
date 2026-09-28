/**
 * Customer emails are stored lowercased and trimmed (a database trigger normalises every write to
 * `customers.email`), so compare them in the same form.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The email that identifies a signed-in user as a Paddle customer: their address, normalised, and only once
 * they have confirmed it. Anyone can sign up with a purchaser's address, so an unconfirmed one identifies
 * no one. The owner policies apply the same rule in the database.
 */
export function confirmedEmail(
  user: { email?: string | null; email_confirmed_at?: string | null } | null | undefined,
): string | null {
  return user?.email && user.email_confirmed_at ? normaliseEmail(user.email) : null;
}
