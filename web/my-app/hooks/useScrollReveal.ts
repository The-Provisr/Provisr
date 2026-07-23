"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

type RevealOptions = gsap.TweenVars & {
  start?: string;
};

export function useScrollReveal<T extends HTMLElement>(
  selector: string,
  options: RevealOptions = {},
) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const root = ref.current;
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (!root || prefersReducedMotion) {
      return;
    }

    const { start = "top 80%", scrollTrigger, ...tweenOptions } = options;

    const ctx = gsap.context(() => {
      gsap.from(selector, {
        y: 30,
        opacity: 0,
        duration: 0.7,
        stagger: 0.12,
        ease: "power3.out",
        ...tweenOptions,
        scrollTrigger: {
          trigger: root,
          start,
          ...(typeof scrollTrigger === "object" ? scrollTrigger : {}),
        },
      });
    }, root);

    return () => ctx.revert();
  }, [selector, options]);

  return ref;
}
