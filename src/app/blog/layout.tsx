import type { ReactNode } from 'react';
import Header from '@/components/home/header/header';
import { Footer } from '@/components/home/footer/footer';

export default function BlogLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <>
      <Header />
      <main>{children}</main>
      <Footer />
    </>
  );
}
