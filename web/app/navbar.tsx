import { Cloud } from "lucide-react";

const navItems = ["Home", "Features", "Testimonials", "Pricing"];

const buttonClass =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-white/15 bg-white/10 px-7 text-base font-medium text-[#e1fdff] shadow-[0_8px_24px_rgba(0,0,0,0.16)] backdrop-blur-md transition hover:-translate-y-0.5 hover:border-[#3b82f6]/50 hover:bg-[#3b82f6]/20";

export default function Navbar() {
  return (
    <nav
      className="fixed top-0 z-50 w-screen"
      aria-label="Primary navigation"
      data-animate="nav"
      style={{ left: "calc(50% - 50vw)" }}
    >
      <div className="absolute inset-0 -z-10 w-full border-b border-white/10 bg-[#050a14]/20 shadow-[0_12px_36px_rgba(0,0,0,0.14)] backdrop-blur-2xl" />
      <div className="flex w-full items-center justify-between gap-6 py-4 pl-8 pr-5 md:pl-20 md:pr-8">
        <a
          className="inline-flex items-center gap-2.5 font-[family-name:var(--font-display)] text-xl font-extrabold md:text-2xl"
          href="#top"
          aria-label="Provisr home"
        >
          <span className="grid size-[34px] place-items-center rounded-lg bg-[#3b82f6] text-[#061424]">
            <Cloud size={20} strokeWidth={2.4} />
          </span>
          <span>Provisr</span>
        </a>
        <div className="hidden items-center gap-8 text-[#b9cacb] md:flex">
          {navItems.map((item, index) => (
            <a
              className={`border-b-2 pb-1.5 transition-colors hover:text-[#3b82f6] ${
                index === 0 ? "border-[#3b82f6] text-[#e1fdff]" : "border-transparent"
              }`}
              href={index === 0 ? "#top" : `#${item.toLowerCase()}`}
              key={item}
            >
              {item}
            </a>
          ))}
        </div>
        <a className={`${buttonClass} hidden sm:inline-flex`} href="#login">
          Get Started
        </a>
      </div>
    </nav>
  );
}
