import Image from "next/image";
import { creations } from "@/lib/data";
import { SectionHeading } from "./SectionHeading";
import { ScrollRevealSection } from "./ScrollRevealSection";

export function CreationsSection() {
  return (
    <ScrollRevealSection
      id="creations"
      className="py-20 md:py-28"
      selector=".creation-card"
      start="top 80%"
    >
      <div className="mx-auto max-w-7xl px-6 md:px-10">
        <SectionHeading
          title="Our latest creation"
          description="Explore ready-made AI workflows crafted for fast-moving teams and builders."
        />

        <div className="creations-grid grid grid-cols-1 gap-8 md:grid-cols-3">
          {creations.map((creation) => (
            <article key={creation.title} className="creation-card group">
              <div className="aspect-[4/3] overflow-hidden rounded-2xl border border-white/10 bg-[#111222]">
                <Image
                  src={creation.image}
                  alt={creation.title}
                  width={1200}
                  height={900}
                  className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
              </div>
              <h3 className="mt-6 text-xl font-semibold tracking-normal text-[#f7f8ff] md:text-2xl">
                {creation.title}
              </h3>
              <p className="mt-3 text-base leading-relaxed text-[#a7adbe]">
                {creation.description}
              </p>
            </article>
          ))}
        </div>
      </div>
    </ScrollRevealSection>
  );
}
