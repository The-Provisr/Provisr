"use client";

import { useScrollReveal } from "@/hooks/useScrollReveal";
import type { ReactNode } from "react";

export function ScrollRevealSection({
  children,
  className = "",
  id,
  selector,
  start,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  selector: string;
  start?: string;
}) {
  const ref = useScrollReveal<HTMLElement>(selector, { start });

  return (
    <section ref={ref} id={id} className={className}>
      {children}
    </section>
  );
}
