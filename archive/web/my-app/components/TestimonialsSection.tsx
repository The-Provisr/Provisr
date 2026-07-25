import Image from "next/image";
import { testimonials } from "@/lib/data";
import { SectionHeading } from "./SectionHeading";
import { ScrollRevealSection } from "./ScrollRevealSection";

export function TestimonialsSection() {
  return (
    <ScrollRevealSection
      id="testimonials"
      className="py-20 md:py-28"
      selector=".testimonial-card"
      start="top 80%"
    >
      <div className="mx-auto max-w-7xl px-6 md:px-10">
        <SectionHeading
          title="Our Testimonials"
          description="Loved by creators, designers and engineers building the next generation of AI products."
        />

        <div className="testimonials-grid grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {testimonials.map((testimonial) => (
            <article
              key={testimonial.name}
              className="testimonial-card rounded-2xl border border-white/10 bg-[#111222] p-6 transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-indigo-950/40 md:p-8"
            >
              <p className="min-h-28 text-base leading-relaxed text-[#a7adbe]">
                &ldquo;{testimonial.quote}&rdquo;
              </p>
              <div className="my-6 h-px bg-white/10" />
              <div className="flex items-center gap-4">
                <Image
                  src={testimonial.avatar}
                  alt={testimonial.name}
                  width={48}
                  height={48}
                  className="size-12 rounded-full object-cover"
                />
                <div>
                  <h3 className="font-semibold text-[#f7f8ff]">
                    {testimonial.name}
                  </h3>
                  <p className="mt-1 text-sm text-[#a7adbe]">
                    {testimonial.role}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </ScrollRevealSection>
  );
}
