import { BillingFrequency, IBillingFrequency } from '@/constants/billing-frequency';
import { cn } from '@/lib/utils';

interface Props {
  frequency: IBillingFrequency;
  setFrequency: (frequency: IBillingFrequency) => void;
}

// A pair of toggle buttons: the choice changes the prices shown, it does not switch between panels.
export function Toggle({ setFrequency, frequency }: Props) {
  return (
    <div className={'mb-8 flex justify-center'}>
      <div
        role={'group'}
        aria-label={'Billing frequency'}
        className={
          'inline-flex items-center gap-1 rounded-lg border border-border bg-background p-1 text-sm text-muted-foreground'
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
                'inline-flex h-9 cursor-pointer items-center justify-center whitespace-nowrap rounded-md px-5 font-medium transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
                selected && 'bg-primary text-primary-foreground shadow-xs hover:text-primary-foreground',
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
