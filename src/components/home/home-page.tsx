import '../../styles/home-page.css';
import Header from '@/components/home/header/header';
import { HeroSection } from '@/components/home/hero-section/hero-section';
import { Pricing } from '@/components/home/pricing/pricing';
import { HomePageBackground } from '@/components/gradients/home-page-background';
import { Footer } from '@/components/home/footer/footer';

export function HomePage() {
  return (
    <>
      <div>
        <HomePageBackground />
        <Header />
        <HeroSection />
        <Pricing />
        <Footer />
      </div>
    </>
  );
}
