"use client";

import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Logo } from "./Logo";

gsap.registerPlugin(ScrollTrigger);

const navLinks = [
  ["Creations", "#creations"],
  ["About", "#about"],
  ["Testimonials", "#testimonials"],
  ["Contact", "#contact"],
];

export function Navbar() {
  const navRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const ctx = gsap.context(() => {
      if (!prefersReducedMotion) {
        gsap.from(".nav-reveal", {
          y: -12,
          opacity: 0,
          duration: 0.5,
          stagger: 0.06,
          ease: "power2.out",
        });
      }

      ScrollTrigger.create({
        trigger: document.body,
        start: "top -80",
        onToggle: (self) => setScrolled(self.isActive),
      });
    }, navRef);

    return () => ctx.revert();
  }, []);

  return (
    <nav
      ref={navRef}
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "border-b border-white/10 bg-[#070711]/80 shadow-sm shadow-black/30 backdrop-blur-md"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6 md:px-10">
        <div className="nav-reveal">
          <Logo />
        </div>

        <div className="nav-reveal hidden items-center gap-8 md:flex">
          {navLinks.map(([label, href]) => (
            <a
              key={label}
              href={href}
              className="text-sm font-medium text-[#a7adbe] transition-colors hover:text-white"
            >
              {label}
            </a>
          ))}
        </div>

        <div className="nav-reveal hidden items-center gap-3 md:flex">
          <a
            href="#"
            className="rounded-full px-5 py-2.5 text-sm font-medium text-[#f7f8ff] transition-colors hover:bg-white/10"
          >
            Login
          </a>
          <a
            href="#contact"
            className="rounded-full bg-[#1D4ED8] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#1E40AF]"
          >
            Get started
          </a>
        </div>

        <button
          type="button"
          className="nav-reveal grid size-11 place-items-center rounded-full border border-white/10 bg-white/5 text-[#f7f8ff] md:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      <div
        className={`overflow-hidden border-t border-white/10 bg-[#0d0e1a] transition-[max-height] duration-300 md:hidden ${
          open ? "max-h-96" : "max-h-0 border-transparent"
        }`}
      >
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-6 py-5">
          {navLinks.map(([label, href]) => (
            <a
              key={label}
              href={href}
              onClick={() => setOpen(false)}
              className="rounded-xl px-3 py-3 text-sm font-medium text-[#a7adbe] hover:bg-white/10 hover:text-white"
            >
              {label}
            </a>
          ))}
          <a
            href="#contact"
            onClick={() => setOpen(false)}
            className="mt-2 rounded-full bg-[#6366f1] px-5 py-3 text-center text-sm font-medium text-white"
          >
            Get started
          </a>
        </div>
      </div>
    </nav>
  );
}
