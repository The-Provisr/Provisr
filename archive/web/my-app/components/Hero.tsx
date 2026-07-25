"use client";

import Image from "next/image";
import { ArrowRight, CalendarDays, Play } from "lucide-react";
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Beams from "./Beams";

gsap.registerPlugin(ScrollTrigger);

export function Hero() {
  const heroRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = heroRef.current;
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (!root || prefersReducedMotion) {
      return;
    }

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

      tl.from(".hero-badge", { y: 20, opacity: 0, duration: 0.5 })
        .from(".hero-heading", { y: 30, opacity: 0, duration: 0.7 }, "-=0.3")
        .from(".hero-sub", { y: 20, opacity: 0, duration: 0.6 }, "-=0.4")
        .from(
          ".hero-cta > *",
          { y: 16, opacity: 0, duration: 0.5, stagger: 0.1 },
          "-=0.3",
        )
        .from(
          ".hero-image",
          { y: 60, opacity: 0, scale: 0.96, duration: 0.9 },
          "-=0.2",
        );

      gsap.to(".hero-image", {
        yPercent: 8,
        ease: "none",
        scrollTrigger: {
          trigger: root,
          start: "top top",
          end: "bottom top",
          scrub: true,
        },
      });
    }, heroRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={heroRef}
      className="hero relative overflow-hidden bg-[#070711] pt-32 pb-20 md:pt-40 md:pb-28"
    >
      <div className="absolute inset-0 opacity-75">
        <Beams
          beamWidth={3}
          beamHeight={30}
          beamNumber={20}
          lightColor="#ffffff"
          speed={2}
          noiseIntensity={1.75}
          scale={0.2}
          rotation={30}
        />
      </div>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(7,7,17,0.08)_0%,rgba(7,7,17,0.58)_48%,#070711_100%)]" />
      <div className="relative mx-auto max-w-7xl px-6 text-center md:px-10">

        <h1 className="hero-heading mx-auto mt-7 max-w-4xl text-5xl font-semibold leading-[1.05] tracking-normal text-[#f7f8ff] md:text-6xl lg:text-7xl">
          Describe it. We will provision it.
        </h1>

        <p className="hero-sub mx-auto mt-6 max-w-xl text-lg leading-8 text-[#a7adbe]">
          Provisr is an AI-powered platform that turns natural language into secure, compliant, multi-cloud infrastructure.
        </p>

        <div className="hero-cta mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href="#contact"
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#1D4ED8] px-6 font-medium text-white transition-colors hover:bg-[#1E40AF] sm:w-auto"
          >
            Get started
            <ArrowRight size={18} />
          </a>
          <a
            href="#contact"
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-white/10 px-6 font-medium text-[#f7f8ff] transition-colors hover:bg-white/10 sm:w-auto"
          >
            <Play size={17} />
            Book a demo
          </a>
        </div>

        <div className="hero-image mx-auto mt-16 max-w-6xl">
          <Image
            src="/agentix-dashboard.svg"
            alt="Agentix dashboard analytics preview"
            width={2048}
            height={826}
            priority
            className="h-auto w-full"
          />
        </div>
      </div>
    </section>
  );
}
