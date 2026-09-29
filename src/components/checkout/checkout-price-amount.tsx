import { Skeleton } from '@/components/ui/skeleton';
import { CheckoutEventsData } from '@paddle/paddle-js/types/checkout/events';
import { formatMoney } from '@/utils/paddle/parse-money';

interface Props {
  checkoutData: CheckoutEventsData | null;
}

export function CheckoutPriceAmount({ checkoutData }: Props) {
  const total = checkoutData?.totals.total;
  return (
    <>
      {total !== undefined ? (
        <div className={'pt-8 flex gap-2 items-end'}>
          <span className={'text-4xl font-bold tracking-tight'}>{formatMoney(total, checkoutData?.currency_code)}</span>
          <span className={'pb-1 text-sm text-muted-foreground'}>inc. tax</span>
        </div>
      ) : (
        <Skeleton className="mt-8 h-[48px] w-full" />
      )}
    </>
  );
}
