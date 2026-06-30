import Link from 'next/link';
import { User } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';

interface Props {
  user: User | null;
}

export default function Header({ user }: Props) {
  return (
    <nav>
      <div className="mx-auto max-w-7xl relative px-[32px] py-[18px] flex items-center justify-between">
        <div className="flex flex-1 items-center justify-start gap-8">
          <Link className="flex items-center text-xl font-semibold tracking-tight" href={'/'}>
            Tenantry
          </Link>
          <div className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
            <Link className="hover:text-primary" href={'/docs'}>
              Docs
            </Link>
            <Link className="hover:text-primary" href={'/#pricing'}>
              Pricing
            </Link>
            <Link
              className="hover:text-primary"
              href={'https://github.com/tenantry-org/tenantry-core'}
              target={'_blank'}
            >
              GitHub
            </Link>
          </div>
        </div>
        <div className="flex flex-1 items-center justify-end">
          <div className="flex space-x-4">
            {user?.id ? (
              <Button variant={'secondary'} asChild={true}>
                <Link href={'/dashboard'}>Dashboard</Link>
              </Button>
            ) : (
              <Button asChild={true} variant={'secondary'}>
                <Link href={'/login'}>Sign in</Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
