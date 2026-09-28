import { Skeleton } from '@/components/ui/skeleton';

// Shown at once on navigation while a dashboard page loads its data from Paddle and the database.
export default function DashboardLoading() {
  return (
    <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-8" aria-busy={true} aria-label={'Loading'}>
      <Skeleton className={'h-9 w-64'} />
      <Skeleton className={'h-40 w-full'} />
      <Skeleton className={'h-64 w-full'} />
    </main>
  );
}
