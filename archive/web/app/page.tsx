import Image from "next/image";
import {
  BadgeCheck,
  Bolt,
  CheckCircle2,
  Cloud,
  CreditCard,
  MessageSquareText,
  ShieldCheck,
  Users,
} from "lucide-react";
import LandingAnimations from "./landing-animations";
import Navbar from "./navbar";

const features = [
  {
    title: "Simple requests",
    text: "Just type what you need. Provisr translates your intent into secure cloud configurations.",
    icon: MessageSquareText,
  },
  {
    title: "Clear cost estimates",
    text: "Know exactly what you'll pay before you click deploy, with transparent pricing for every resource.",
    icon: CreditCard,
  },
  {
    title: "Approval before launch",
    text: "No accidental deletions or massive bills. Every change requires an explicit team sign-off.",
    icon: BadgeCheck,
  },
  {
    title: "Team visibility",
    text: "See who launched what and when. A centralized dashboard keeps everyone on the same page.",
    icon: Users,
  },
  {
    title: "Safer cloud changes",
    text: "Automated policy checks help every deployment follow security and operational guardrails.",
    icon: ShieldCheck,
  },
  {
    title: "Fast setup",
    text: "Connect your cloud provider and start provisioning managed resources in minutes.",
    icon: Bolt,
  },
];

const testimonials = [
  {
    name: "Maya Fernando",
    role: "Engineering Manager",
    image: "/images/maya.png",
    quote:
      "Provisr has completely changed how our product teams interact with infrastructure. We've reduced deployment wait times by over 70%.",
  },
  {
    name: "Daniel Perera",
    role: "Cloud Lead",
    image: "/images/daniel.png",
    quote:
      "The cost projection feature is a game-changer. Finally, our developers understand the financial impact of their choices.",
  },
  {
    name: "Aisha Khan",
    role: "Product Operations",
    image: "/images/aisha.png",
    quote:
      "I don't need to be a cloud architect to provision what my team needs. Provisr makes me feel empowered and safe.",
  },
  {
    name: "Marcus Chen",
    role: "DevOps Lead",
    quote:
      "Provisr has streamlined our infrastructure reviews. It's the most intuitive tool we've added this year.",
  },
];

const testimonialLoop = [...testimonials, ...testimonials];

const trustLogos = ["Nexora", "CloudPeak", "DevGrid", "InfraLabs", "StackPilot"];

const buttonClass =
  "inline-flex min-h-12 items-center justify-center rounded-full border border-white/15 bg-white/10 px-9 text-base font-medium text-[#e1fdff] shadow-[0_10px_30px_rgba(0,0,0,0.18)] backdrop-blur-md transition hover:-translate-y-0.5 hover:border-[#3b82f6]/50 hover:bg-[#3b82f6]/20";

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#050a14] text-[#e1fdff]">
      <LandingAnimations />
      <Navbar />

      <section
        className="relative min-h-[860px] px-5 pb-16 pt-[170px] md:min-h-[1040px] md:px-16 md:pt-[240px]"
        id="top"
      >
        <div className="pointer-events-none absolute -left-28 -top-28 size-[460px] rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.18),transparent_68%)] blur-[70px]" />
        <div className="pointer-events-none absolute -right-44 bottom-20 size-[460px] rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.18),transparent_68%)] blur-[70px]" />
        <Image
          src="/images/cloud-bg.png"
          alt=""
          fill
          priority
          className="object-cover opacity-15 mix-blend-screen grayscale [filter:brightness(0.55)_contrast(1.2)]"
          sizes="100vw"
        />
        <div className="relative z-10 mx-auto flex w-full max-w-[1280px] flex-col items-center text-center">
          <h1
            className="mb-6 max-w-[760px] font-[family-name:var(--font-display)] text-[42px] font-bold leading-[1.02] tracking-normal md:text-[74px]"
            data-animate="hero"
          >
            Cloud provisioning <span className="block text-[#3b82f6]">made simple</span>
          </h1>
          <p
            className="mb-9 max-w-[760px] text-lg leading-8 text-[#b9cacb] md:text-[22px] md:leading-9"
            data-animate="hero"
          >
            Describe what you need, review the plan, and launch your cloud resources
            with confidence. No YAML headaches, just results.
          </p>
          <div className="flex w-full justify-center" data-animate="hero">
            <a className={`${buttonClass} min-h-14 px-11 text-lg`} href="#login">
              Get Started
            </a>
          </div>
          <div
            className="relative mt-16 w-full max-w-[1180px] overflow-hidden rounded-[18px] border border-[#233554] bg-[#112240] shadow-[0_32px_90px_rgba(0,0,0,0.48)] before:absolute before:-inset-[18%] before:-z-10 before:bg-[radial-gradient(circle,rgba(59,130,246,0.16),transparent_55%)] md:mt-24"
            aria-label="Provisr cloud planning preview"
            data-animate="product"
          >
            <Image
              src="/images/product-mockup.png"
              alt="Provisr chat interface mockup"
              width={1678}
              height={937}
              priority
            />
          </div>
        </div>
      </section>

      <section
        className="border-y border-[#849495]/20 bg-[#0d1515]/50 px-5 py-12 text-center md:px-16"
        aria-label="Trusted by modern cloud teams"
        data-animate="section"
      >
        <p className="mb-6 text-xs font-extrabold uppercase text-[#b9cacb]/65">
          Trusted by modern cloud teams
        </p>
        <div className="flex flex-wrap justify-center gap-x-16 gap-y-6">
          {trustLogos.map((logo) => (
            <span className="text-xl font-extrabold text-[#e1fdff]/65" key={logo}>
              {logo}
            </span>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1280px] px-5 py-20 md:px-16 md:py-24" id="features">
        <div className="mx-auto mb-12 max-w-[640px] text-center" data-animate="section">
          <h2 className="mb-3.5 font-[family-name:var(--font-display)] text-[32px] font-bold leading-tight md:text-[52px]">
            Infrastructure, but human.
          </h2>
          <p className="leading-7 text-[#b9cacb]">
            Skip the complexity and focus on building. Provisr handles orchestration
            with built-in guardrails.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {features.map(({ title, text, icon: Icon }) => (
            <article
              className="min-h-[230px] rounded-[18px] border border-[#233554] bg-[#112240] p-7 transition hover:-translate-y-1 hover:border-[#3b82f6] hover:bg-[#172a45]"
              key={title}
              data-animate="card"
            >
              <span className="grid size-12 place-items-center rounded-xl bg-[#3b82f6]/15 text-[#3b82f6]">
                <Icon size={24} />
              </span>
              <h3 className="mb-2.5 mt-5 text-xl font-bold">{title}</h3>
              <p className="text-sm leading-6 text-[#b9cacb]">{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto flex w-full max-w-[1280px] justify-center px-5 py-20 md:px-16 md:py-24" id="login">
        <div
          className="w-full max-w-[450px] rounded-[18px] border border-[#233554] bg-[#112240] p-7 shadow-[0_0_28px_-12px_rgba(59,130,246,0.45)] md:p-10"
          data-animate="section"
        >
          <div className="mx-auto mb-8 max-w-[640px] text-center">
            <h2 className="mb-3.5 font-[family-name:var(--font-display)] text-[32px] font-bold leading-tight md:text-[52px]">
              Welcome back
            </h2>
            <p className="leading-7 text-[#b9cacb]">Log in to manage your cloud</p>
          </div>
          <form className="grid gap-5">
            <label>
              <span className="mb-2 block text-xs font-extrabold uppercase text-[#b9cacb]">
                Email address
              </span>
              <input
                className="w-full rounded-xl border border-[#233554] bg-[#0a192f] px-4 py-3.5 text-[#e1fdff] outline-none transition focus:border-[#3b82f6] focus:ring-4 focus:ring-[#3b82f6]/20"
                type="email"
                placeholder="name@company.com"
              />
            </label>
            <label>
              <span className="mb-2 block text-xs font-extrabold uppercase text-[#b9cacb]">
                Password
              </span>
              <input
                className="w-full rounded-xl border border-[#233554] bg-[#0a192f] px-4 py-3.5 text-[#e1fdff] outline-none transition focus:border-[#3b82f6] focus:ring-4 focus:ring-[#3b82f6]/20"
                type="password"
                placeholder="••••••••"
              />
            </label>
            <button type="button" className={`${buttonClass} w-full`}>
              Login
            </button>
          </form>
          <div className="mt-6 text-center">
            <a className="font-bold text-[#3b82f6]" href="#top">
              Forgot password?
            </a>
            <p className="mt-3.5 text-sm text-[#b9cacb]">
              New to Provisr?{" "}
              <a className="font-bold text-[#3b82f6]" href="#pricing">
                Create an account
              </a>
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1280px] px-5 py-20 md:px-16 md:py-24" id="testimonials">
        <div className="testimonial-marquee">
          <div className="testimonial-track">
            {testimonialLoop.map((person, index) => (
              <article
                className="w-[300px] shrink-0 rounded-[18px] border border-[#849495]/20 bg-[#151d1e]/90 p-7 md:w-[340px]"
                key={`${person.name}-${index}`}
                aria-hidden={index >= testimonials.length}
              >
                <div className="mb-6 flex items-center gap-3.5">
                  {person.image ? (
                    <Image
                      className="size-12 rounded-full object-cover"
                      src={person.image}
                      alt=""
                      width={48}
                      height={48}
                    />
                  ) : (
                    <span className="grid size-12 place-items-center rounded-full bg-[#3b82f6]/15 text-[#3b82f6]">
                      <Users size={22} />
                    </span>
                  )}
                  <div>
                    <h3 className="mb-1 font-bold">{person.name}</h3>
                    <p className="text-sm leading-6 text-[#b9cacb]">{person.role}</p>
                  </div>
                </div>
                <blockquote className="m-0 text-sm italic leading-6 text-[#e1fdff]">
                  {person.quote}
                </blockquote>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="relative mx-auto mb-16 w-full max-w-[1280px] px-5 py-20 md:px-16 md:py-24" id="pricing">
        <div className="pointer-events-none absolute right-8 top-12 size-[460px] rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.18),transparent_68%)] blur-[70px]" />
        <div className="pointer-events-none absolute bottom-12 left-8 size-[460px] rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.18),transparent_68%)] blur-[70px]" />
        <div
          className="relative z-10 overflow-hidden rounded-[32px] border border-[#3b82f6]/30 bg-gradient-to-br from-[#112240] to-[#0a192f] px-8 py-12 text-center md:p-[72px]"
          data-animate="section"
        >
          <CheckCircle2 className="mx-auto mb-5 text-[#3b82f6]" size={30} />
          <h2 className="mb-3.5 font-[family-name:var(--font-display)] text-[32px] font-bold leading-tight md:text-[52px]">
            Start provisioning with confidence
          </h2>
          <p className="mx-auto mb-8 max-w-2xl leading-7 text-[#b9cacb]">
            Join hundreds of teams who have simplified cloud operations with Provisr.
          </p>
          <a className={buttonClass} href="#login">
            Get Started for Free
          </a>
        </div>
      </section>

      <footer className="flex flex-col items-center justify-between gap-6 border-t border-[#849495]/20 bg-[#0d1515] px-5 py-12 text-center md:flex-row md:px-16 md:text-left">
        <div className="inline-flex items-center gap-2.5 font-[family-name:var(--font-display)] text-2xl font-extrabold">
          <span className="grid size-[26px] place-items-center rounded-md bg-[#3b82f6] text-[#061424]">
            <Cloud size={16} />
          </span>
          <span>Provisr</span>
        </div>
        <p className="m-0 text-sm text-[#b9cacb]">
          © 2024 Provisr Cloud Solutions. All rights reserved.
        </p>
        <div className="flex flex-wrap justify-center gap-x-7 gap-y-4 text-[#b9cacb] md:justify-end">
          <a className="transition-colors hover:text-[#3b82f6]" href="#top">
            Privacy Policy
          </a>
          <a className="transition-colors hover:text-[#3b82f6]" href="#top">
            Terms of Service
          </a>
          <a className="transition-colors hover:text-[#3b82f6]" href="#top">
            Contact Support
          </a>
          <a className="transition-colors hover:text-[#3b82f6]" href="#features">
            Documentation
          </a>
        </div>
      </footer>
    </main>
  );
}
