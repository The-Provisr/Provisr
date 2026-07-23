export function SectionHeading({
  title,
  description,
  light = false,
}: {
  title: string;
  description: string;
  light?: boolean;
}) {
  return (
    <div className="mx-auto mb-14 max-w-2xl text-center">
      <h2
        className={`text-3xl font-semibold tracking-normal md:text-4xl ${
          light ? "text-white" : "text-[#f7f8ff]"
        }`}
      >
        {title}
      </h2>
      <p
        className={`mt-4 text-base leading-relaxed md:text-lg ${
          light ? "text-[#d6d7dd]" : "text-[#a7adbe]"
        }`}
      >
        {description}
      </p>
    </div>
  );
}
