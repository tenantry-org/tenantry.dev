import { cn } from '@/lib/utils';

/** The Tenantry wordmark, as the home page header shows it, until there is a logo. */
export function Wordmark({ className }: Readonly<{ className?: string }>) {
  return <span className={cn('text-xl font-semibold tracking-tight', className)}>Tenantry</span>;
}
