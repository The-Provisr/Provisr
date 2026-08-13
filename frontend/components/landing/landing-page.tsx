"use client";

import { useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  CloudProviderLogo,
  type CloudProviderId,
} from "@/components/ui/cloud-provider-logo";
import styles from "./landing-page.module.css";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const flowSteps = [
  {
    id: "01",
    title: "Describe the outcome",
    text: "Ask for the architecture in plain language. Provisr gathers policy, cloud context, and the details it still needs.",
    note: "Natural language in",
  },
  {
    id: "02",
    title: "Review the evidence",
    text: "Inspect the manifest, cost, security posture, Terraform plan, and every policy decision before anything changes.",
    note: "A clear plan out",
  },
  {
    id: "03",
    title: "Approve with confidence",
    text: "Confirmation and role-aware approvals remain hard gates. Controlled workers execute only after every check passes.",
    note: "Governed execution",
  },
];

const providers: readonly { label: string; provider?: CloudProviderId }[] = [
  { label: "Amazon Web Services", provider: "aws" },
  { label: "Microsoft Azure", provider: "azure" },
  { label: "Google Cloud", provider: "gcp" },
  { label: "Terraform" },
  { label: "Open Policy Agent" },
];

const cloudProviders = [
  { label: "AWS", provider: "aws" },
  { label: "Azure", provider: "azure" },
  { label: "GCP", provider: "gcp" },
] as const satisfies readonly { label: string; provider: CloudProviderId }[];

function ArrowIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path d="M4 9h10M10 5l4 4-4 4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m3.5 8.5 2.7 2.7 6.3-6.4" />
    </svg>
  );
}

function BrandMark() {
  return (
    <span className={styles.brandMark} aria-hidden="true">
      <Image src="/logo.png" alt="" fill sizes="32px" />
    </span>
  );
}

export function LandingPage() {
  const page = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;

      if (reducedMotion) {
        gsap.set(`.${styles.revealWord}`, { opacity: 1 });
        return;
      }

      gsap
        .timeline({ defaults: { ease: "power3.out" } })
        .from(`.${styles.nav}`, { y: -28, opacity: 0, duration: 0.8 })
        .from(
          `.${styles.heroEyebrow}, .${styles.heroTitle}, .${styles.heroCopy}, .${styles.heroActions}`,
          { y: 42, opacity: 0, duration: 0.9, stagger: 0.1 },
          "-=0.45",
        )
        .from(
          `.${styles.console}`,
          { x: 90, y: 70, rotate: 2, opacity: 0, duration: 1.1 },
          "-=0.8",
        );

      const words = gsap.utils.toArray<HTMLElement>(
        `.${styles.revealWord}`,
      );
      gsap.fromTo(
        words,
        { opacity: 0.1 },
        {
          opacity: 1,
          stagger: 0.05,
          ease: "none",
          scrollTrigger: {
            trigger: `.${styles.statement}`,
            start: "top 74%",
            end: "bottom 48%",
            scrub: 0.6,
          },
        },
      );

      const workflowStage = page.current?.querySelector<HTMLElement>(
        `.${styles.workflowStage}`,
      );
      const stack = page.current?.querySelector<HTMLElement>(
        `.${styles.stack}`,
      );
      const cards = gsap.utils.toArray<HTMLElement>(
        `.${styles.stackCard}`,
      );

      if (workflowStage && stack && cards.length) {
        gsap.set(cards, {
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          marginBottom: 0,
          transformOrigin: "center top",
          zIndex: (index) => index + 1,
        });
        gsap.set(cards.slice(1), {
          yPercent: 112,
          scale: 0.96,
        });

        const workflowTimeline = gsap.timeline({
          scrollTrigger: {
            trigger: workflowStage,
            start: "top top",
            end: () => `+=${window.innerHeight * (cards.length + 0.5)}`,
            pin: true,
            pinSpacing: true,
            scrub: 0.8,
            anticipatePin: 1,
            invalidateOnRefresh: true,
          },
        });

        cards.slice(1).forEach((card, index) => {
          const previousCard = cards[index];
          const beat = index;

          if (!previousCard) {
            return;
          }

          workflowTimeline
            .to(
              previousCard,
              {
                yPercent: -3.5,
                scale: 0.92 - index * 0.02,
                opacity: 0.38,
                duration: 1,
                ease: "none",
              },
              beat,
            )
            .to(
              card,
              {
                yPercent: 0,
                scale: 1,
                opacity: 1,
                duration: 1,
                ease: "none",
              },
              beat,
            );
        });

        workflowTimeline.to(cards.at(-1)!, {
          scale: 1,
          duration: 0.55,
        });
      }

      gsap.from(`.${styles.bentoCard}`, {
        y: 70,
        opacity: 0,
        duration: 0.85,
        stagger: 0.08,
        ease: "power3.out",
        scrollTrigger: {
          trigger: `.${styles.bento}`,
          start: "top 72%",
        },
      });
    },
    { scope: page },
  );

  const statement =
    "From a sentence to live infrastructure, every decision stays visible, every gate stays enforced, and every change stays accountable.";

  return (
    <main ref={page} className={styles.page}>
      <nav className={styles.nav} aria-label="Primary navigation">
        <Link href="/" className={styles.brand} aria-label="Provisr home">
          <BrandMark />
          <span>provisr</span>
        </Link>
        <div className={styles.navLinks}>
          <a href="#platform">Platform</a>
          <a href="#workflow">How it works</a>
          <a href="#control">Governance</a>
        </div>
        <Link href="/chat" className={styles.navAction}>
          Open workspace
          <ArrowIcon />
        </Link>
      </nav>

      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroAtmosphere} aria-hidden="true" />
        <div className={styles.heroCopyBlock}>
          <p className={styles.heroEyebrow}>Governed cloud provisioning</p>
          <h1 id="hero-title" className={styles.heroTitle}>
            <span>Ask for infrastructure.</span>
            <span>Keep control of it.</span>
          </h1>
          <p className={styles.heroCopy}>
            Provisr turns plain-language requests into policy-aware cloud
            infrastructure, then keeps every plan, approval, and execution in
            one auditable flow.
          </p>
          <div className={styles.heroActions}>
            <Link href="/onboarding" className={styles.primaryButton}>
              Start provisioning
              <ArrowIcon />
            </Link>
            <a href="#workflow" className={styles.secondaryButton}>
              See the workflow
            </a>
          </div>
        </div>

        <div className={styles.consoleWrap}>
          <div className={styles.orbit} aria-hidden="true" />
          <div className={styles.console}>
            <div className={styles.consoleTop}>
              <div className={styles.consoleBrand}>
                <BrandMark />
                <span>New request</span>
              </div>
              <span className={styles.liveSignal}>
                <i />
                Policy active
              </span>
            </div>
            <div className={styles.requestBubble}>
              Deploy a production-ready API on AWS with a private database,
              encrypted storage, and a monthly budget below $900.
            </div>
            <div className={styles.consoleFlow}>
              <div className={styles.flowLine}>
                <span className={styles.flowCheck}>
                  <CheckIcon />
                </span>
                <span>
                  <strong>Workspace policy loaded</strong>
                  <small>12 controls applied</small>
                </span>
              </div>
              <div className={styles.flowLine}>
                <span className={styles.flowCheck}>
                  <CheckIcon />
                </span>
                <span>
                  <strong>Architecture validated</strong>
                  <small>7 resources in ap-southeast-1</small>
                </span>
              </div>
              <div className={styles.flowLine}>
                <span className={styles.flowPulse} />
                <span>
                  <strong>Terraform plan ready</strong>
                  <small>Waiting for your review</small>
                </span>
                <span className={styles.planBadge}>Review</span>
              </div>
            </div>
            <div className={styles.consoleFooter}>
              <div>
                <span>Estimated monthly cost</span>
                <strong>$742</strong>
              </div>
              <span className={styles.withinBudget}>Within budget</span>
            </div>
          </div>
        </div>
        <a className={styles.scrollCue} href="#platform">
          <span>Scroll to inspect</span>
          <i aria-hidden="true" />
        </a>
      </section>

      <section id="platform" className={styles.platform}>
        <div className={styles.sectionIntro}>
          <p>One system of control</p>
          <h2>
            Speed without the blind spot{" "}
            <span className={styles.inlineImage}>
              <Image
                src="/logo.png"
                alt=""
                fill
                sizes="160px"
                aria-hidden="true"
              />
            </span>
          </h2>
        </div>

        <div className={styles.bento}>
          <article className={`${styles.bentoCard} ${styles.policyCard}`}>
            <div className={styles.cardCopy}>
              <span className={styles.cardKicker}>Policy before plan</span>
              <h3>Guardrails enter the room first.</h3>
              <p>
                Workspace policy, account context, and existing resources
                shape the architecture before a manifest or Terraform is
                generated.
              </p>
            </div>
            <div className={styles.featureIllustration}>
              <Image
                src="/assets/policy-guardrails.png"
                alt="Infrastructure components passing through layered policy guardrails"
                fill
                sizes="(max-width: 760px) 100vw, 42vw"
              />
            </div>
          </article>

          <article className={`${styles.bentoCard} ${styles.cloudCard}`}>
            <div className={styles.cardIllustration}>
              <Image
                src="/assets/multicloud-translation.png"
                alt="One infrastructure intent branching into three provider environments"
                fill
                sizes="(max-width: 760px) 100vw, 33vw"
              />
            </div>
            <span className={styles.cardKicker}>Multi-cloud by design</span>
            <h3>Your intent, translated to the right provider.</h3>
            <div className={styles.cloudMarks} aria-label="Cloud providers">
              {cloudProviders.map(({ label, provider }) => (
                <span className={styles.cloudMark} key={provider}>
                  <CloudProviderLogo provider={provider} size="sm" />
                  <span className={styles.cloudMarkLabel}>{label}</span>
                </span>
              ))}
            </div>
          </article>

          <article className={`${styles.bentoCard} ${styles.auditCard}`}>
            <div className={styles.cardIllustration}>
              <Image
                src="/assets/audit-evidence.png"
                alt="A permanent sequence of evidence entering an immutable archive"
                fill
                sizes="(max-width: 760px) 100vw, 33vw"
              />
            </div>
            <span className={styles.cardKicker}>Evidence built in</span>
            <h3>Nothing important disappears into a black box.</h3>
          </article>

          <article className={`${styles.bentoCard} ${styles.approvalCard}`}>
            <div className={styles.approvalCopy}>
              <span className={styles.cardKicker}>Humans hold the keys</span>
              <h3>Automation moves fast. Authority stays explicit.</h3>
              <p>
                User confirmation is always required. Sensitive changes add
                secure, role-aware approval before controlled workers can act.
              </p>
            </div>
            <div className={styles.featureIllustration}>
              <Image
                src="/assets/approval-gates.png"
                alt="A controlled execution path passing through two explicit approval gates"
                fill
                sizes="(max-width: 760px) 100vw, 48vw"
              />
            </div>
          </article>
        </div>
      </section>

      <section className={styles.statement}>
        <p aria-label={statement}>
          {statement.split(" ").map((word, index) => (
            <span key={`${word}-${index}`} className={styles.revealWord} aria-hidden="true">
              {word}{" "}
            </span>
          ))}
        </p>
      </section>

      <section id="control" className={styles.accordionSection}>
        <div className={styles.sectionIntro}>
          <p>Control at every altitude</p>
          <h2>One request. Three ways to see the truth.</h2>
        </div>
        <div className={styles.accordion}>
          <article className={styles.accordionPanel}>
            <span className={styles.panelIndex}>A</span>
            <div className={styles.panelCopy}>
              <h3>For requesters</h3>
              <p>
                Clear questions, sensible defaults, and explanations without
                forcing everyone to become a Terraform expert.
              </p>
            </div>
            <div className={styles.panelArt}>
              <Image
                src="/assets/multicloud-translation.png"
                alt=""
                fill
                sizes="(max-width: 760px) 100vw, 34vw"
              />
              <div className={styles.panelArtCaption}>
                <span>One request, safely translated</span>
                <strong>Clear intent without provider guesswork</strong>
              </div>
            </div>
          </article>
          <article className={styles.accordionPanel}>
            <span className={styles.panelIndex}>B</span>
            <div className={styles.panelCopy}>
              <h3>For approvers</h3>
              <p>
                Risk, cost, security, and policy evidence distilled into the
                decision that needs your attention.
              </p>
            </div>
            <div className={styles.panelArt}>
              <Image
                src="/assets/approval-gates.png"
                alt=""
                fill
                sizes="(max-width: 760px) 100vw, 34vw"
              />
              <div className={styles.panelArtCaption}>
                <span>Authority remains explicit</span>
                <strong>Every sensitive change meets its approver</strong>
              </div>
            </div>
          </article>
          <article className={styles.accordionPanel}>
            <span className={styles.panelIndex}>C</span>
            <div className={styles.panelCopy}>
              <h3>For auditors</h3>
              <p>
                Immutable transitions connect every request, tool call,
                artifact, decision, and resulting cloud resource.
              </p>
            </div>
            <div className={styles.panelArt}>
              <Image
                src="/assets/audit-evidence.png"
                alt=""
                fill
                sizes="(max-width: 760px) 100vw, 34vw"
              />
              <div className={styles.panelArtCaption}>
                <span>Evidence follows every transition</span>
                <strong>Complete chain of custody, preserved</strong>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section id="workflow" className={styles.workflow}>
        <div className={styles.workflowStage}>
          <div className={styles.workflowHeader}>
            <p>From request to resource</p>
            <h2>The safe path is the fast path.</h2>
            <span>
              Provisr keeps planning intelligent and execution deterministic.
            </span>
          </div>
          <div className={styles.stack}>
            {flowSteps.map((step) => (
              <article className={styles.stackCard} key={step.id}>
                <div className={styles.stackNumber}>{step.id}</div>
                <div className={styles.stackCopy}>
                  <span>{step.note}</span>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </div>
                <div className={styles.stackRoute} aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <span><CheckIcon /></span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.marquee} aria-label="Supported platform ecosystem">
        <div className={styles.marqueeTrack}>
          {[...providers, ...providers].map(({ label, provider }, index) => (
            <span className={styles.marqueeItem} key={`${label}-${index}`}>
              {provider ? <CloudProviderLogo provider={provider} size="sm" /> : null}
              {label}
              <i className={styles.marqueeSeparator} />
            </span>
          ))}
        </div>
      </section>

      <section className={styles.cta}>
        <div className={styles.ctaGlow} aria-hidden="true" />
        <BrandMark />
        <h2>Infrastructure should move at the speed of intent.</h2>
        <p>Without leaving policy, approvals, or accountability behind.</p>
        <Link href="/onboarding" className={styles.primaryButton}>
          Create your workspace
          <ArrowIcon />
        </Link>
      </section>

      <footer className={styles.footer}>
        <Link href="/" className={styles.brand}>
          <BrandMark />
          <span>provisr</span>
        </Link>
        <p>Plan intelligently. Execute deliberately.</p>
        <div>
          <Link href="/chat">Workspace</Link>
          <Link href="/resources">Resources</Link>
          <Link href="/audit">Audit</Link>
        </div>
      </footer>
    </main>
  );
}
