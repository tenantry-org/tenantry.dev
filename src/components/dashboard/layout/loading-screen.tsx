import { LoaderIcon } from 'lucide-react';

export function LoadingScreen() {
  return (
    <div className={'flex w-full flex-col items-center pt-24 text-muted-foreground'} aria-busy={true}>
      <LoaderIcon className={'h-5 w-5 animate-spin'} aria-label={'Loading'} />
    </div>
  );
}
