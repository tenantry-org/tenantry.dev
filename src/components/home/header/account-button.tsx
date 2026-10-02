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
  const user = await getCurrentUser();
  if (!user) return <SignInButton />;

  return (
    <Button asChild={true} size={'sm'}>
      <Link href={'/dashboard/pro'}>Dashboard</Link>
    </Button>
  );
}
