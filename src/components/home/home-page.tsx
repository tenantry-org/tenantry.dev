import Header from '@/components/home/header/header';
import { HeroSection } from '@/components/home/hero-section/hero-section';
import { Features } from '@/components/home/features/features';
import { Registry } from '@/components/home/registry/registry';
import { ComparisonSection } from '@/components/home/comparison/comparison-section';
import { Pricing } from '@/components/home/pricing/pricing';
import { Footer } from '@/components/home/footer/footer';
import { ProofStrip } from '@/components/shared/proof-strip';

export function HomePage() {
  return (
    <>
      <Header />
      <main>
        <HeroSection />
        <ProofStrip samples={'core'} />
        <Features />
        <Registry />
        <ComparisonSection />
        <Pricing />
      </main>
      <Footer />
    </>
  );
}
