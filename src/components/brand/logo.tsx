'use client';

import { useId } from 'react';
import { cn } from '@/lib/utils';

// From branding/tenantry-logo.svg and tenantry-icon.svg. The shield keeps its brand blues on any background;
// the wordmark is drawn in currentColor, so it is navy on light surfaces and near-white on dark ones.

const SHIELD =
  'M12 10 a2 2 0 0 1 2-2 H19 a1 1 0 0 1 1 1 V13 H27 V9 a1 1 0 0 1 1-1 H36 a1 1 0 0 1 1 1 V13 H44 V9 a1 1 0 0 1 1-1 H50 a2 2 0 0 1 2 2 V32 C52 44.5 43.5 52.5 32 58 C20.5 52.5 12 44.5 12 32 Z';

const WORDMARK =
  'M113.93 26.32V14.98H165.97V26.32H146.59V79H133.36V26.32ZM180.71 80.03Q173.84 80.03 168.75 76.98Q163.65 73.93 160.84 68.58Q158.03 63.23 158.03 56.36Q158.03 49.44 160.88 44.07Q163.74 38.7 168.77 35.64Q173.79 32.59 180.28 32.59Q186.99 32.59 191.99 35.58Q197 38.57 199.81 43.87Q202.63 49.18 202.63 56.1V59.49H170.36Q170.53 64.52 173.32 67.53Q176.12 70.54 181.1 70.54Q184.79 70.54 187.27 68.95Q189.74 67.36 190.6 64.73H202.15Q201.34 69.25 198.33 72.68Q195.32 76.12 190.77 78.08Q186.21 80.03 180.71 80.03ZM170.44 51.41H190.68Q190.21 47.16 187.52 44.69Q184.84 42.22 180.54 42.22Q176.29 42.22 173.62 44.69Q170.96 47.16 170.44 51.41ZM220.51 53.78V79H207.83V33.62H220.29V40.76Q222.61 36.89 226.09 34.79Q229.57 32.68 234.47 32.68Q241.69 32.68 246.03 37.34Q250.37 42 250.37 50.6V79H237.74V52.92Q237.74 48.36 235.55 45.98Q233.36 43.59 229.4 43.59Q225.49 43.59 223 46.04Q220.51 48.49 220.51 53.78ZM271.65 79.77Q264.86 79.77 260.45 76.38Q256.05 72.98 256.05 66.2Q256.05 61.08 258.5 58.18Q260.95 55.28 264.99 53.95Q269.03 52.62 273.75 52.19Q279.98 51.54 282.47 50.9Q284.97 50.25 284.97 48.06V47.76Q284.97 45.27 282.99 43.68Q281.01 42.09 277.53 42.09Q274.01 42.09 271.82 43.72Q269.63 45.36 269.41 47.98H257.51Q257.94 40.97 263.27 36.83Q268.6 32.68 277.92 32.68Q287.24 32.68 292.36 36.83Q297.47 40.97 297.47 48.23V79H285.1V72.6H284.92Q283.12 75.91 279.98 77.84Q276.85 79.77 271.65 79.77ZM275.17 70.96Q279.72 70.96 282.39 68.54Q285.05 66.11 285.05 62.41V57.86Q283.98 58.46 281.49 58.96Q278.99 59.45 275.94 59.92Q272.68 60.44 270.42 61.79Q268.17 63.14 268.17 65.85Q268.17 68.26 270.08 69.61Q271.99 70.96 275.17 70.96ZM317.5 53.78V79H304.82V33.62H317.29V40.76Q319.61 36.89 323.09 34.79Q326.57 32.68 331.46 32.68Q338.68 32.68 343.02 37.34Q347.36 42 347.36 50.6V79H334.73V52.92Q334.73 48.36 332.54 45.98Q330.35 43.59 326.39 43.59Q322.48 43.59 319.99 46.04Q317.5 48.49 317.5 53.78ZM380.84 33.62V43.55H371.56V64.99Q371.56 67.31 372.48 68.19Q373.41 69.07 375.99 69.07H380.84V79H373.45Q365.97 79 362.43 76.08Q358.88 73.16 358.88 66.97V43.55H351.06V33.62H358.88V21.25H371.56V33.62ZM385.62 79V33.62H397.82V41.36H397.95Q399.2 37.28 401.86 35.3Q404.52 33.32 409.04 33.32Q410.15 33.32 411.08 33.37Q412 33.41 412.77 33.41V44.2Q412.09 44.15 410.5 44.07Q408.91 43.98 407.32 43.98Q403.41 43.98 400.85 46.64Q398.29 49.31 398.29 54.42V79ZM419.22 96.96V86.95H424.98Q427.26 86.95 428.36 85.85Q429.45 84.76 430.35 82.14L431.6 78.83L414.15 33.62H427.43L435.04 56.05Q435.81 58.5 436.56 60.95Q437.31 63.4 438.04 65.85Q438.78 63.4 439.55 60.93Q440.32 58.46 441.1 56.05L448.74 33.62H461.89L441.91 86Q439.76 91.68 436.33 94.32Q432.89 96.96 427.6 96.96Z';

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
