'use client';

import { LogOut } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';

export function LogoutButton() {
  async function logout() {
    await createClient().auth.signOut();
    location.reload();
  }

  return (
    <button
      type={'button'}
      onClick={logout}
      aria-label={'Log out'}
      title={'Log out'}
      className={
        'cursor-pointer rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
      }
    >
      <LogOut className={'h-4 w-4'} />
    </button>
  );
}
