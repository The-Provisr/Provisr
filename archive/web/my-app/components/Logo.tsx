import Image from "next/image";

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <a href="#" className="flex items-center gap-3" aria-label="Provisr home">
      <Image
        src="/logo-icon.svg"
        alt=""
        width={36}
        height={36}
        className="size-12"
        priority
      />

      <span
        className={`text-xl font-semibold tracking-tight ${
          light ? "text-white" : "text-[#f7f8ff]"
        }`}
      >
        Provisr
      </span>
    </a>
  );
}