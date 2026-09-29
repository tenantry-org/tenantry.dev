'use client';

import { LogOut } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';

export function LogoutButton() {
  async function logout() {
    await createClient().auth.signOut();
    location.reload();
  }

  return (
    <button type={'button'} onClick={logout} aria-label={'Log out'} className={'text-muted-foreground'}>
      <LogOut className={'h-6 w-6'} />
    </button>
  );
}
