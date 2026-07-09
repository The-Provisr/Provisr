import { ArrowRight } from "lucide-react";
import { Logo } from "./Logo";
import { ScrollRevealSection } from "./ScrollRevealSection";

const companyLinks = ["About us", "Careers", "Contact us", "Privacy policy"];

export function Footer() {
  return (
    <ScrollRevealSection
      className="bg-[#05050c] pt-16 text-[#d6d7dd]"
      selector=".footer-reveal"
      start="top 85%"
    >
      <div className="mx-auto max-w-7xl px-6 md:px-10">
        <div className="grid gap-10 pb-12 md:grid-cols-[1.2fr_0.8fr_1fr]">
          <div className="footer-reveal">
            <Logo light />
            <p className="mt-5 max-w-sm text-base leading-relaxed text-[#a6a8b3]">
              PrebuiltUI is a free and open-source UI component library with
              over 300+ beautifully crafted, customizable components built with
              Tailwind CSS.
            </p>
          </div>

          <div className="footer-reveal">
            <h2 className="font-semibold text-white">Company</h2>
            <div className="mt-5 flex flex-col gap-3">
              {companyLinks.map((link) => (
                <a
                  key={link}
                  href={link === "Contact us" ? "#contact" : "#"}
                  className="text-sm text-[#a6a8b3] transition-colors hover:text-white"
                >
                  {link}
                  {link === "Careers" && (
                    <span className="ml-2 rounded-full bg-white/10 px-2 py-1 text-xs text-white">
                      We&apos;re hiring!
                    </span>
                  )}
                </a>
              ))}
            </div>
          </div>

          <div className="footer-reveal">
            <h2 className="font-semibold text-white">
              Subscribe to our newsletter
            </h2>
            <p className="mt-4 text-sm leading-6 text-[#a6a8b3]">
              The latest news, articles, and resources, sent to your inbox
              weekly.
            </p>
            <form className="mt-5 flex gap-2">
              <label className="min-w-0 flex-1">
                <span className="sr-only">Email address</span>
                <input
                  type="email"
                  placeholder="Email address"
                  className="h-11 w-full rounded-full border border-white/10 bg-white/5 px-4 text-sm text-white outline-none placeholder:text-[#7e8190] focus:border-[#6366f1]"
                />
              </label>
              <button
                type="submit"
                className="grid size-11 shrink-0 place-items-center rounded-full bg-[#6366f1] text-white transition-colors hover:bg-[#4f46e5]"
                aria-label="Subscribe"
              >
                <ArrowRight size={18} />
              </button>
            </form>
          </div>
        </div>

        <div className="border-t border-white/10 py-6 text-center text-sm text-[#8f929d]">
          Copyright 2025 © PrebuiltUI All Right Reserved.
        </div>
      </div>
    </ScrollRevealSection>
  );
}
