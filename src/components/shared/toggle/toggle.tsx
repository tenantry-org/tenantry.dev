import { BillingFrequency, IBillingFrequency } from '@/constants/billing-frequency';
import { cn } from '@/lib/utils';

interface Props {
  frequency: IBillingFrequency;
  setFrequency: (frequency: IBillingFrequency) => void;
}

// A pair of toggle buttons: the choice changes the prices shown, it does not switch between panels.
export function Toggle({ setFrequency, frequency }: Props) {
  return (
    <div className="flex justify-center mb-8">
      <div
        role={'group'}
        aria-label={'Billing frequency'}
        className={
          'inline-flex h-14 items-center gap-[8px] justify-center rounded-sm bg-background px-[6px] py-[6px] text-muted-foreground border-border border'
        }
      >
        {BillingFrequency.map((billingFrequency) => {
          const selected = billingFrequency.value === frequency.value;
          return (
            <button
              key={billingFrequency.value}
              type={'button'}
              aria-pressed={selected}
              onClick={() => setFrequency(billingFrequency)}
              className={cn(
                'inline-flex items-center justify-center whitespace-nowrap rounded-xs h-11 px-5 py-[10px] text-md font-medium cursor-pointer ring-offset-background transition-all focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                selected && 'bg-[#182222] text-foreground shadow-xs',
              )}
            >
              {billingFrequency.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
