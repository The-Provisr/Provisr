"use client";

import { ArrowRight } from "lucide-react";
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { companies } from "@/lib/data";
import { SectionHeading } from "./SectionHeading";

gsap.registerPlugin(ScrollTrigger);

export function TrustedCompanies() {
  const sectionRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = sectionRef.current;
    const track = trackRef.current;
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (!root || !track || prefersReducedMotion) {
      return;
    }

    const ctx = gsap.context(() => {
      gsap.from(".trusted-reveal", {
        scrollTrigger: { trigger: root, start: "top 80%" },
        y: 30,
        opacity: 0,
        duration: 0.7,
        stagger: 0.12,
        ease: "power3.out",
      });

      const marquee = gsap.to(track, {
        xPercent: -50,
        repeat: -1,
        duration: window.innerWidth < 768 ? 26 : 20,
        ease: "none",
      });

      track.addEventListener("mouseenter", () => marquee.pause());
      track.addEventListener("mouseleave", () => marquee.resume());
    }, root);

    return () => ctx.revert();
  }, []);

  const logoSet = [...companies, ...companies];

  return (
    <section ref={sectionRef} className="py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-6 md:px-10">
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#111222] px-6 py-12 text-center shadow-2xl shadow-black/30 md:px-12 md:py-16">
          <div className="trusted-reveal mx-auto mb-6 inline-flex rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-medium text-white">
            NEW · Try 30 days free trial option
          </div>

          <div className="trusted-reveal">
            <SectionHeading
              light
              title="Trusted by leading companies."
              description="Built to integrate effortlessly with your existing tools, frameworks and workflows - so you can move faster."
            />
          </div>

          <a
            href="#contact"
            className="trusted-reveal mx-auto inline-flex items-center gap-2 rounded-full bg-[#6366f1] px-6 py-3 font-medium text-white transition-colors hover:bg-[#4f46e5]"
          >
            Read more
            <ArrowRight size={18} />
          </a>

          <div className="trusted-reveal mt-12 overflow-hidden border-y border-white/10 py-5">
            <div ref={trackRef} className="logo-track flex w-max gap-4">
              {logoSet.map((company, index) => (
                <div
                  key={`${company}-${index}`}
                  className="flex h-14 w-40 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-sm font-semibold uppercase tracking-[0.16em] text-[#d6d7dd]"
                >
                  {company}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
