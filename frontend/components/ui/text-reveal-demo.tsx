"use client";

import { TextRevealByWord } from "@/components/ui/text-reveal";
import { cn } from "@/lib/cn";

export function TextRevealDemo() {
  return (
    <div className="relative min-h-[200vh] w-full">
      <div className="pointer-events-none fixed inset-0 flex items-center justify-center">
        <div className="mx-auto w-full max-w-5xl p-4">
          <div
            className={cn(
              "pointer-events-auto flex h-[500px] w-full items-center justify-center rounded-lg",
              "border border-neutral-800 bg-black/50 backdrop-blur-sm",
            )}
          >
            <TextRevealByWord text="Every decision visible. Every gate enforced. Every change accountable." />
          </div>
        </div>
      </div>
      <div className="h-[200vh]" aria-hidden="true" />
    </div>
  );
}
