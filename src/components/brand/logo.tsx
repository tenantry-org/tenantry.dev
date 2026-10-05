'use client';

import { useId } from 'react';
import { cn } from '@/lib/utils';
import { SHIELD, WORDMARK } from '@/components/brand/logo-paths';

// The shield keeps its brand blues on any background; the wordmark is drawn in currentColor, so it is navy on light
// surfaces and near-white on dark ones.

// Each instance needs its own ids: a page can hold several logos (the docs render a hidden mobile copy), and
// url(#id) resolves to the first element with that id, which draws nothing if its <svg> is hidden. A client
// component, so an element placed twice (the docs' nav title) still renders, and takes an id, in each place.
function Shield() {
  const id = useId();
  const clip = `${id}-clip`;
  const fill = `${id}-fill`;
  return (
    <>
      <defs>
        <clipPath id={clip}>
          <path d={SHIELD} />
        </clipPath>
        <linearGradient id={fill} x1={'0'} y1={'0'} x2={'0'} y2={'1'}>
          <stop offset={'0'} stopColor={'#3B82F6'} />
          <stop offset={'1'} stopColor={'#2563EB'} />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect width={'64'} height={'64'} fill={`url(#${fill})`} />
        <rect x={'32'} width={'32'} height={'64'} fill={'#1D4ED8'} />
      </g>
      <rect x={'22'} y={'22'} width={'8'} height={'8'} rx={'1.5'} fill={'#DBEAFE'} fillOpacity={0.5} />
      <rect x={'34'} y={'22'} width={'8'} height={'8'} rx={'1.5'} fill={'#FFFFFF'} />
      <rect x={'22'} y={'34'} width={'8'} height={'8'} rx={'1.5'} fill={'#DBEAFE'} fillOpacity={0.5} />
      <rect x={'34'} y={'34'} width={'8'} height={'8'} rx={'1.5'} fill={'#DBEAFE'} fillOpacity={0.5} />
    </>
  );
}

/** The shield-and-tiles mark on its own. Size it with a height class; the width follows. */
export function LogoMark({ className }: Readonly<{ className?: string }>) {
  return (
    <svg viewBox={'8 4 48 58'} className={cn('h-8 w-auto shrink-0', className)} aria-hidden={true}>
      <Shield />
    </svg>
  );
}

/** The full logo: mark and wordmark. Size it with a height class; the width follows. */
export function Logo({ className }: Readonly<{ className?: string }>) {
  return (
    <svg viewBox={'0 0 466 110'} className={cn('h-7 w-auto shrink-0', className)} role={'img'} aria-label={'Tenantry'}>
      <g transform={'translate(-10 0) scale(1.8)'}>
        <Shield />
      </g>
      <path fill={'currentColor'} d={WORDMARK} />
    </svg>
  );
}
