import { redirect } from 'next/navigation';

// The customer portal starts at Pro access: the licence, GitHub access and subscription state.
export default function DashboardPage() {
  redirect('/dashboard/pro');
}
