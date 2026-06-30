import { DashboardUsageCardGroup } from '@/components/dashboard/landing/components/dashboard-usage-card-group';
import { DashboardSubscriptionCardGroup } from '@/components/dashboard/landing/components/dashboard-subscription-card-group';

export function DashboardLandingPage() {
  return (
    <div className={'grid flex-1 auto-rows-max items-start gap-6 p-0'}>
      <DashboardUsageCardGroup />
      <DashboardSubscriptionCardGroup />
    </div>
  );
}
