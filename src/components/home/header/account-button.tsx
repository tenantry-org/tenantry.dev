import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { getCurrentUser } from '@/server/db/current-user';

export function SignInButton() {
  return (
    <Button asChild={true} variant={'outline'} size={'sm'}>
      <Link href={'/login'}>Sign in</Link>
    </Button>
  );
}

/** Dashboard for a signed-in user, otherwise Sign in. Reads the session, so it streams in. */
export async function AccountButton() {
  // Auth out of reach shows Sign in, rather than failing the page.
  const user = await getCurrentUser().catch(() => null);
  if (!user) return <SignInButton />;

  return (
    <Button asChild={true} size={'sm'}>
      <Link href={'/dashboard/pro'}>Dashboard</Link>
    </Button>
  );
}
