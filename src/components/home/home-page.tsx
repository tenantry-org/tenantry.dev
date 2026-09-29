import Header from '@/components/home/header/header';
import { HeroSection } from '@/components/home/hero-section/hero-section';
import { Features } from '@/components/home/features/features';
import { Pricing } from '@/components/home/pricing/pricing';
import { Footer } from '@/components/home/footer/footer';

export function HomePage() {
  return (
    <>
      <Header />
      <main>
        <HeroSection />
        <Features />
        <Pricing />
      </main>
      <Footer />
    </>
  );
}
