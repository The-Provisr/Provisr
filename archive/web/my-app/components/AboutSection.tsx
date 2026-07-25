import { features } from "@/lib/data";
import { SectionHeading } from "./SectionHeading";
import { ScrollRevealSection } from "./ScrollRevealSection";

export function AboutSection() {
  return (
    <ScrollRevealSection
      id="about"
      className="bg-[#0b0c16] py-20 md:py-28"
      selector=".about-item"
      start="top 75%"
    >
      <div className="mx-auto max-w-7xl px-6 md:px-10">
        <SectionHeading
          title="About our apps"
          description="Everything you need to ship intelligent interfaces with less setup and more confidence."
        />

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-8">
          {features.map((feature) => (
            <article
              key={feature.title}
              className="about-item rounded-2xl border border-white/10 bg-[#111222] p-8 text-center"
            >
              <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-indigo-400/10 text-3xl">
                {feature.icon}
              </div>
              <h3 className="mt-6 text-xl font-semibold text-[#f7f8ff] md:text-2xl">
                {feature.title}
              </h3>
              <p className="mt-3 text-base leading-relaxed text-[#a7adbe]">
                {feature.description}
              </p>
            </article>
          ))}
        </div>
      </div>
    </ScrollRevealSection>
  );
}
