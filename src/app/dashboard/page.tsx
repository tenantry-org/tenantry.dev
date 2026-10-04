import { redirect } from 'next/navigation';

// The customer portal starts at Pro access: the feed tokens and the licence key.
export default function DashboardPage() {
  redirect('/dashboard/pro');
}
