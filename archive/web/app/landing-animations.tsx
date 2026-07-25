"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger, useGSAP);

export default function LandingAnimations() {
  useGSAP(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion) {
      gsap.set("[data-animate]", { clearProps: "all" });
      return;
    }

    gsap.from("[data-animate='nav']", {
      y: -24,
      autoAlpha: 0,
      duration: 0.7,
      ease: "power3.out",
    });

    gsap.from("[data-animate='hero']", {
      y: 28,
      autoAlpha: 0,
      duration: 0.9,
      stagger: 0.12,
      ease: "power3.out",
    });

    gsap.from("[data-animate='product']", {
      y: 42,
      autoAlpha: 0,
      scale: 0.96,
      duration: 1,
      delay: 0.25,
      ease: "power3.out",
    });

    gsap.utils.toArray<HTMLElement>("[data-animate='section']").forEach((section) => {
      gsap.from(section, {
        y: 32,
        autoAlpha: 0,
        duration: 0.75,
        ease: "power3.out",
        scrollTrigger: {
          trigger: section,
          start: "top 82%",
          once: true,
        },
      });
    });

    gsap.utils.toArray<HTMLElement>("[data-animate='card']").forEach((card) => {
      gsap.from(card, {
        y: 34,
        autoAlpha: 0,
        duration: 0.65,
        ease: "power3.out",
        scrollTrigger: {
          trigger: card,
          start: "top 88%",
          once: true,
        },
      });
    });
  });

  return null;
}
