import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface Props {
  isOpen: boolean;
  title: ReactNode;
  description: ReactNode;
  onClose: (open: boolean) => void;
  onConfirm: () => void;
  /** The confirm button's text: what confirming does. */
  confirmLabel: string;
  /** Destructive for an action that ends something, such as cancelling. */
  destructive?: boolean;
}

export function Confirmation({ isOpen, onClose, title, description, onConfirm, confirmLabel, destructive }: Props) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className={'flex flex-col gap-6'}>
          <DialogDescription>{description}</DialogDescription>
          <div className={'flex gap-4 items-center justify-end w-full'}>
            <Button onClick={() => onClose(false)} variant={'outline'}>
              Close
            </Button>
            <Button onClick={() => onConfirm()} variant={destructive ? 'destructive' : 'default'}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
