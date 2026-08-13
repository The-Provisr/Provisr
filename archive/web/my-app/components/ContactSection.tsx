"use client";

import { Send } from "lucide-react";
import { useRef } from "react";
import type { FocusEvent } from "react";
import gsap from "gsap";
import { ScrollRevealSection } from "./ScrollRevealSection";
import { SectionHeading } from "./SectionHeading";

export function ContactSection() {
  const formRef = useRef<HTMLFormElement>(null);

  function handleFocus(event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
    gsap.to(event.currentTarget, { scale: 1.01, duration: 0.2 });
  }

  function handleBlur(event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
    gsap.to(event.currentTarget, { scale: 1, duration: 0.2 });
  }

  return (
    <ScrollRevealSection
      id="contact"
      className="bg-[#0b0c16] py-20 md:py-28"
      selector=".contact-field"
      start="top 80%"
    >
      <div className="mx-auto max-w-7xl px-6 md:px-10">
        <SectionHeading
          title="Get in touch"
          description="Tell us what you are building and we will help you shape the right AI workflow."
        />

        <form
          ref={formRef}
          className="contact-form mx-auto max-w-xl rounded-2xl border border-white/10 bg-[#111222] p-6 shadow-xl shadow-black/30 md:p-8"
        >
          <label className="contact-field block">
            <span className="text-sm font-medium text-[#f7f8ff]">
              Your name
            </span>
            <input
              type="text"
              placeholder="Richard Nelson"
              onFocus={handleFocus}
              onBlur={handleBlur}
              className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#0b0c16] px-4 text-[#f7f8ff] outline-none transition-shadow placeholder:text-[#6f7485] focus:border-[#818cf8] focus:ring-2 focus:ring-[#818cf8]/20"
            />
          </label>

          <label className="contact-field mt-5 block">
            <span className="text-sm font-medium text-[#f7f8ff]">
              Email id
            </span>
            <input
              type="email"
              placeholder="you@example.com"
              onFocus={handleFocus}
              onBlur={handleBlur}
              className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#0b0c16] px-4 text-[#f7f8ff] outline-none transition-shadow placeholder:text-[#6f7485] focus:border-[#818cf8] focus:ring-2 focus:ring-[#818cf8]/20"
            />
          </label>

          <label className="contact-field mt-5 block">
            <span className="text-sm font-medium text-[#f7f8ff]">Message</span>
            <textarea
              rows={5}
              placeholder="How can we help?"
              onFocus={handleFocus}
              onBlur={handleBlur}
              className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-[#0b0c16] px-4 py-3 text-[#f7f8ff] outline-none transition-shadow placeholder:text-[#6f7485] focus:border-[#818cf8] focus:ring-2 focus:ring-[#818cf8]/20"
            />
          </label>

          <button
            type="submit"
            className="contact-field mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#6366f1] px-6 font-medium text-white transition-colors hover:bg-[#4f46e5]"
          >
            Submit message
            <Send size={17} />
          </button>
        </form>
      </div>
    </ScrollRevealSection>
  );
}
