import { Mail } from "lucide-react";

export function NewsletterBand() {
  return (
    <section className="py-16">
      <div className="mx-auto max-w-7xl px-6 md:px-10">
        <div className="flex flex-col items-center justify-between gap-6 rounded-2xl border border-indigo-300/20 bg-[#6366f1] px-6 py-10 text-center shadow-2xl shadow-indigo-950/40 md:flex-row md:px-10 md:text-left">
          <div>
            <h2 className="text-3xl font-semibold tracking-normal text-white">
              Subscribe newsletter
            </h2>
            <p className="mt-3 max-w-xl text-base leading-relaxed text-indigo-100">
              Get product updates and practical AI workflow ideas in your inbox.
            </p>
          </div>

          <form className="flex w-full flex-col gap-3 sm:max-w-md sm:flex-row">
            <label className="relative flex-1">
              <span className="sr-only">Email address</span>
              <Mail
                size={18}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#a7adbe]"
              />
              <input
                type="email"
                placeholder="Email address"
                className="h-12 w-full rounded-full border border-white/10 bg-[#0b0c16] pl-11 pr-4 text-[#f7f8ff] outline-none placeholder:text-[#a7adbe]"
              />
            </label>
            <button
              type="submit"
              className="h-12 rounded-full bg-[#05050c] px-6 font-medium text-white transition-colors hover:bg-[#181a2b]"
            >
              Subscribe
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
