import { AboutSection } from "@/components/AboutSection";
import { ContactSection } from "@/components/ContactSection";
import { CreationsSection } from "@/components/CreationsSection";
import { Footer } from "@/components/Footer";
import { Hero } from "@/components/Hero";
import { Navbar } from "@/components/Navbar";
import { NewsletterBand } from "@/components/NewsletterBand";
import { TestimonialsSection } from "@/components/TestimonialsSection";
import { TrustedCompanies } from "@/components/TrustedCompanies";

export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <CreationsSection />
        <AboutSection />
        <TestimonialsSection />
        <TrustedCompanies />
        <ContactSection />
        <NewsletterBand />
      </main>
      <Footer />
    </>
  );
}
