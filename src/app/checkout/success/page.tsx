import { CircleCheck } from 'lucide-react';
import { SuccessPageGradients } from '@/components/gradients/success-page-gradients';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { PoweredByPaddle } from '@/components/home/footer/powered-by-paddle';
import '../../../styles/checkout.css';
import { createClient } from '@/utils/supabase/server';

export default async function SuccessPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  return (
    <main>
      <div className={'relative h-screen overflow-hidden'}>
        <SuccessPageGradients />
        <div className={'absolute inset-0 px-6 flex items-center justify-center'}>
          <div className={'flex flex-col items-center text-white text-center'}>
            <CircleCheck className={'mb-12 h-24 w-24 text-green-400'} aria-hidden={true} />
            <h1 className={'text-4xl md:text-[80px] leading-9 md:leading-[80px] font-medium pb-6'}>
              Payment successful
            </h1>
            <p className={'text-lg pb-16'}>Success! Your payment is complete, and you’re all set.</p>
            <Button variant={'secondary'} asChild={true}>
              {data.user ? <Link href={'/dashboard'}>Go to Dashboard</Link> : <Link href={'/'}>Go to Home</Link>}
            </Button>
          </div>
        </div>
        <div className={'absolute bottom-0 w-full'}>
          <PoweredByPaddle />
        </div>
      </div>
    </main>
  );
}
