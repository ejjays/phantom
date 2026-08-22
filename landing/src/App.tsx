import Navbar from './components/Navbar';
import Hero from './components/Hero';
import PlatformMarquee from './components/PlatformMarquee';
import Features from './components/Features';
import ScreensShowcase from './components/ScreensShowcase';
import HowItWorks from './components/HowItWorks';
import Faq from './components/Faq';
import Cta from './components/Cta';
import Footer from './components/Footer';

export default function App() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <PlatformMarquee />
        <Features />
        <ScreensShowcase />
        <HowItWorks />
        <Faq />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
