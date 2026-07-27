"use client";

import {
  SignedIn,
  SignedOut,
  SignInButton,
  SignUpButton,
  UserButton,
  useOrganizationList,
  useUser,
} from "@clerk/nextjs";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CloudProviderLogo } from "@/components/ui/cloud-provider-logo";
import styles from "./onboarding-flow.module.css";

const steps = [
  { id: "account", label: "Your account", shortLabel: "Account" },
  { id: "workspace", label: "Create workspace", shortLabel: "Workspace" },
  { id: "team", label: "Invite your team", shortLabel: "Team" },
  { id: "policies", label: "Policy blueprint", shortLabel: "Policies" },
  { id: "cloud", label: "Connect cloud", shortLabel: "Cloud" },
  { id: "review", label: "Review setup", shortLabel: "Review" },
] as const;

type StepId = (typeof steps)[number]["id"];
type Role = "Admin" | "Engineer" | "Approver" | "Auditor";
type Provider = "aws" | "azure" | "gcp";

type Invite = {
  email: string;
  id: number;
  role: Role;
};

type PolicyBlueprint = {
  accent: string;
  description: string;
  id: string;
  name: string;
  rules: string[];
  tag?: string;
};

type CloudProvider = {
  description: string;
  id: Provider;
  name: string;
  setupLabel: string;
};

type FlowState = {
  blueprint: string;
  budget: string;
  connectionStatus: "idle" | "guidance" | "connected";
  defaultEnvironment: "Development" | "Staging" | "Production";
  defaultRegion: string;
  invites: Invite[];
  policySettings: {
    blockPublicStorage: boolean;
    productionApproval: boolean;
    requireEncryption: boolean;
  };
  provider: Provider;
  slug: string;
  workspaceName: string;
};

const policyBlueprints = [
  {
    accent: "violet",
    description:
      "A balanced foundation for most teams building production cloud infrastructure.",
    id: "secure-baseline",
    name: "Secure baseline",
    rules: ["Encryption by default", "Private networking", "7-day backups"],
    tag: "Recommended",
  },
  {
    accent: "blue",
    description:
      "Essential security and spend controls with a lighter approval path.",
    id: "startup-velocity",
    name: "Startup velocity",
    rules: ["Encryption by default", "Spend warnings", "Fast-track dev"],
    tag: undefined,
  },
  {
    accent: "magenta",
    description:
      "Stricter production controls for regulated and audit-heavy workloads.",
    id: "regulated-production",
    name: "Regulated production",
    rules: ["CIS-aligned controls", "Two-person approval", "30-day evidence"],
    tag: undefined,
  },
] as const satisfies readonly PolicyBlueprint[];

const cloudProviders = [
  {
    description: "Connect an AWS account using a delegated IAM role.",
    id: "aws",
    name: "Amazon Web Services",
    setupLabel: "CloudFormation stack",
  },
  {
    description: "Connect an Azure subscription using a managed application.",
    id: "azure",
    name: "Microsoft Azure",
    setupLabel: "Azure deployment",
  },
  {
    description: "Connect a GCP project using workload identity federation.",
    id: "gcp",
    name: "Google Cloud",
    setupLabel: "GCP deployment",
  },
] as const satisfies readonly CloudProvider[];

const initialState: FlowState = {
  blueprint: "secure-baseline",
  budget: "2,500",
  connectionStatus: "idle",
  defaultEnvironment: "Development",
  defaultRegion: "us-east-1",
  invites: [],
  policySettings: {
    blockPublicStorage: true,
    productionApproval: true,
    requireEncryption: true,
  },
  provider: "aws",
  slug: "",
  workspaceName: "",
};

function normalizeSlug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function CheckMark() {
  return <span className={styles.checkMark}>✓</span>;
}

function Brand() {
  return (
    <Link className={styles.brand} href="/">
      <span className={styles.brandMark}>
        <Image alt="" height={30} priority src="/logo.png" width={30} />
      </span>
      <span>Provisr</span>
    </Link>
  );
}

function Progress({
  activeIndex,
  onSelect,
}: {
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <nav aria-label="Onboarding progress" className={styles.progress}>
      <div
        aria-hidden="true"
        className={styles.progressTrack}
        style={{ "--progress": `${(activeIndex / (steps.length - 1)) * 100}%` } as React.CSSProperties}
      />
      {steps.map((step, index) => {
        const isComplete = index < activeIndex;
        const isCurrent = index === activeIndex;

        return (
          <button
            aria-current={isCurrent ? "step" : undefined}
            className={`${styles.progressStep} ${isCurrent ? styles.progressStepCurrent : ""} ${
              isComplete ? styles.progressStepComplete : ""
            }`}
            disabled={index > activeIndex}
            key={step.id}
            onClick={() => onSelect(index)}
            type="button"
          >
            <span className={styles.progressDot}>{isComplete ? "✓" : index + 1}</span>
            <span className={styles.progressLabel}>{step.shortLabel}</span>
          </button>
        );
      })}
    </nav>
  );
}

function Field({
  hint,
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  hint?: string;
  label: string;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <input className={styles.input} {...props} />
      {hint ? <span className={styles.fieldHint}>{hint}</span> : null}
    </label>
  );
}

function SelectField({
  children,
  label,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.selectWrap}>
        <select className={styles.select} {...props}>
          {children}
        </select>
      </span>
    </label>
  );
}

function Intro({
  description,
  eyebrow,
  title,
}: {
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <div className={styles.intro}>
      <span className={styles.eyebrow}>{eyebrow}</span>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}

function AccountStep({
  clerkEnabled,
  userEmail,
  userName,
}: {
  clerkEnabled: boolean;
  userEmail?: string;
  userName?: string;
}) {
  return (
    <div className={styles.accountGrid}>
      <div>
        <Intro
          description="Sign in once, then we’ll create the workspace where your team, policies, cloud accounts, and audit trail live."
          eyebrow="Welcome to Provisr"
          title="Cloud infrastructure starts with a governed workspace."
        />

        {clerkEnabled ? (
          <>
            <SignedOut>
              <div className={styles.authActions}>
                <SignUpButton mode="modal">
                  <button className={styles.primaryButton} type="button">
                    Create your account
                    <span aria-hidden="true">→</span>
                  </button>
                </SignUpButton>
                <SignInButton mode="modal">
                  <button className={styles.secondaryButton} type="button">
                    I already have an account
                  </button>
                </SignInButton>
              </div>
              <p className={styles.authFootnote}>
                Authentication and session security are managed by Clerk.
              </p>
            </SignedOut>
            <SignedIn>
              <div className={styles.signedInCard}>
                <span className={styles.userAvatar}>
                  {(userName || userEmail || "P").charAt(0).toUpperCase()}
                </span>
                <span>
                  <strong>{userName || "Your Provisr account"}</strong>
                  <small>{userEmail}</small>
                </span>
                <span className={styles.successPill}>Signed in</span>
              </div>
            </SignedIn>
          </>
        ) : (
          <div className={styles.previewCard}>
            <span className={styles.previewIcon}>P</span>
            <span>
              <strong>Onboarding preview</strong>
              <small>
                Add Clerk keys to enable secure sign-in. The complete workspace flow is available to preview now.
              </small>
            </span>
            <span className={styles.previewPill}>Preview</span>
          </div>
        )}
      </div>

      <div className={styles.promiseCard}>
        <div className={styles.atmosphere} />
        <span className={styles.cardKicker}>Governance built in</span>
        <h2>Move quickly without losing control.</h2>
        <ul>
          <li>
            <CheckMark />
            Policy checks before plans and execution
          </li>
          <li>
            <CheckMark />
            Delegated cloud access, never shared access keys
          </li>
          <li>
            <CheckMark />
            Approvals and audit evidence for every change
          </li>
        </ul>
        <div className={styles.flowPreview}>
          <span>Request</span>
          <i />
          <span>Policy</span>
          <i />
          <span>Approval</span>
          <i />
          <span>Execute</span>
        </div>
      </div>
    </div>
  );
}

function WorkspaceStep({
  onChange,
  state,
}: {
  onChange: (next: Partial<FlowState>) => void;
  state: FlowState;
}) {
  const monogram = (state.workspaceName || "W").charAt(0).toUpperCase();

  return (
    <div>
      <Intro
        description="Every request, approval, cloud account, and audit event belongs to a workspace. You’ll be its first admin."
        eyebrow="Workspace"
        title="Give your team a home."
      />
      <div className={styles.formLayout}>
        <div className={styles.formStack}>
          <Field
            autoComplete="organization"
            label="Workspace name"
            onChange={(event) => {
              const workspaceName = event.target.value;
              onChange({
                slug: normalizeSlug(workspaceName),
                workspaceName,
              });
            }}
            placeholder="Acme Platform"
            value={state.workspaceName}
          />
          <Field
            hint={`provisr.app/${state.slug || "your-workspace"}`}
            label="Workspace URL"
            onChange={(event) => onChange({ slug: normalizeSlug(event.target.value) })}
            placeholder="acme-platform"
            value={state.slug}
          />
          <div className={styles.twoColumns}>
            <SelectField
              label="Default environment"
              onChange={(event) =>
                onChange({
                  defaultEnvironment: event.target.value as FlowState["defaultEnvironment"],
                })
              }
              value={state.defaultEnvironment}
            >
              <option>Development</option>
              <option>Staging</option>
              <option>Production</option>
            </SelectField>
            <SelectField
              label="Default region"
              onChange={(event) => onChange({ defaultRegion: event.target.value })}
              value={state.defaultRegion}
            >
              <option value="us-east-1">US East (N. Virginia)</option>
              <option value="us-west-2">US West (Oregon)</option>
              <option value="eu-west-1">Europe (Ireland)</option>
              <option value="ap-southeast-1">Asia Pacific (Singapore)</option>
            </SelectField>
          </div>
        </div>

        <aside className={styles.workspacePreview}>
          <span className={styles.workspaceMonogram}>{monogram}</span>
          <span className={styles.cardKicker}>Workspace preview</span>
          <h2>{state.workspaceName || "Your workspace"}</h2>
          <p>{state.slug ? `provisr.app/${state.slug}` : "Your workspace URL will appear here."}</p>
          <div className={styles.previewDetails}>
            <span>
              <small>YOUR ROLE</small>
              Workspace admin
            </span>
            <span>
              <small>DEFAULT</small>
              {state.defaultEnvironment}
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}

function TeamStep({
  invites,
  onChange,
}: {
  invites: Invite[];
  onChange: (invites: Invite[]) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("Engineer");
  const roles: ReadonlyArray<readonly [Role, string]> = [
    ["Admin", "Policies, providers, billing, and team"],
    ["Engineer", "Request and review infrastructure"],
    ["Approver", "Decide gated production changes"],
    ["Auditor", "Read-only access to evidence"],
  ];

  function addInvite() {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      return;
    }

    onChange([...invites, { email: trimmedEmail, id: Date.now(), role }]);
    setEmail("");
  }

  return (
    <div>
      <Intro
        description="Invite collaborators now or skip this step. Roles keep cloud access and Provisr permissions separate."
        eyebrow="Team"
        title="Bring the right people in."
      />
      <div className={styles.teamLayout}>
        <div className={styles.invitePanel}>
          <div className={styles.inviteForm}>
            <Field
              aria-label="Teammate email"
              label="Email address"
              onChange={(event) => setEmail(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addInvite();
                }
              }}
              placeholder="teammate@company.com"
              type="email"
              value={email}
            />
            <SelectField
              label="Role"
              onChange={(event) => setRole(event.target.value as Role)}
              value={role}
            >
              <option>Admin</option>
              <option>Engineer</option>
              <option>Approver</option>
              <option>Auditor</option>
            </SelectField>
            <button className={styles.addButton} onClick={addInvite} type="button">
              Add invite
            </button>
          </div>

          <div className={styles.inviteList}>
            <div className={styles.inviteListHeader}>
              <span>Pending invitations</span>
              <span>{invites.length}</span>
            </div>
            {invites.length ? (
              invites.map((invite) => (
                <div className={styles.inviteRow} key={invite.id}>
                  <span className={styles.inviteAvatar}>{invite.email.charAt(0).toUpperCase()}</span>
                  <span className={styles.inviteIdentity}>
                    <strong>{invite.email}</strong>
                    <small>Invitation will be sent after setup</small>
                  </span>
                  <span className={styles.rolePill}>{invite.role}</span>
                  <button
                    aria-label={`Remove ${invite.email}`}
                    className={styles.removeButton}
                    onClick={() => onChange(invites.filter((item) => item.id !== invite.id))}
                    type="button"
                  >
                    ×
                  </button>
                </div>
              ))
            ) : (
              <div className={styles.emptyInvites}>
                <span>+</span>
                <strong>Your workspace starts with you.</strong>
                <small>Add teammates above or continue and invite them later.</small>
              </div>
            )}
          </div>
        </div>

        <aside className={styles.roleGuide}>
          <span className={styles.cardKicker}>Role guide</span>
          {roles.map(([name, description]) => (
            <div className={styles.roleRow} key={name}>
              <span>{name.charAt(0)}</span>
              <p>
                <strong>{name}</strong>
                <small>{description}</small>
              </p>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}

function Toggle({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={styles.toggleRow}>
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        checked={checked}
        className={styles.toggleInput}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span aria-hidden="true" className={styles.toggleVisual} />
    </label>
  );
}

function PoliciesStep({
  onChange,
  state,
}: {
  onChange: (next: Partial<FlowState>) => void;
  state: FlowState;
}) {
  return (
    <div>
      <Intro
        description="Start with an opinionated blueprint, then tune the guardrails that Provisr checks before confirmation and execution."
        eyebrow="Policy blueprint"
        title="Choose how your workspace stays safe."
      />
      <div className={styles.blueprintGrid}>
        {policyBlueprints.map((blueprint) => {
          const selected = blueprint.id === state.blueprint;
          return (
            <button
              aria-pressed={selected}
              className={`${styles.blueprintCard} ${selected ? styles.blueprintCardSelected : ""}`}
              key={blueprint.id}
              onClick={() => onChange({ blueprint: blueprint.id })}
              type="button"
            >
              <span className={`${styles.blueprintAccent} ${styles[blueprint.accent]}`} />
              <span className={styles.blueprintHeading}>
                <strong>{blueprint.name}</strong>
                {blueprint.tag ? <small>{blueprint.tag}</small> : null}
              </span>
              <p>{blueprint.description}</p>
              <ul>
                {blueprint.rules.map((rule) => (
                  <li key={rule}>
                    <CheckMark />
                    {rule}
                  </li>
                ))}
              </ul>
              <span className={styles.radio}>{selected ? "●" : ""}</span>
            </button>
          );
        })}
      </div>

      <div className={styles.configurationPanel}>
        <div className={styles.configurationHeading}>
          <span>
            <strong>Workspace guardrails</strong>
            <small>You can change these later in Workspace Policies.</small>
          </span>
          <span className={styles.appliesPill}>Applies to all requests</span>
        </div>
        <div className={styles.configurationGrid}>
          <Toggle
            checked={state.policySettings.requireEncryption}
            description="Deny unencrypted storage and databases."
            label="Require encryption"
            onChange={(requireEncryption) =>
              onChange({
                policySettings: { ...state.policySettings, requireEncryption },
              })
            }
          />
          <Toggle
            checked={state.policySettings.productionApproval}
            description="Require an approver before production execution."
            label="Approve production changes"
            onChange={(productionApproval) =>
              onChange({
                policySettings: { ...state.policySettings, productionApproval },
              })
            }
          />
          <Toggle
            checked={state.policySettings.blockPublicStorage}
            description="Deny public object storage by default."
            label="Block public storage"
            onChange={(blockPublicStorage) =>
              onChange({
                policySettings: { ...state.policySettings, blockPublicStorage },
              })
            }
          />
          <Field
            label="Monthly request threshold (USD)"
            min="0"
            onChange={(event) => onChange({ budget: event.target.value })}
            type="number"
            value={state.budget}
          />
        </div>
      </div>
    </div>
  );
}

function CloudStep({
  onChange,
  state,
}: {
  onChange: (next: Partial<FlowState>) => void;
  state: FlowState;
}) {
  const provider = cloudProviders.find((item) => item.id === state.provider) ?? cloudProviders[0];

  return (
    <div>
      <Intro
        description="Connect one provider now. Provisr uses a delegated execution identity and short-lived credentials—never browser-submitted access keys."
        eyebrow="Cloud account"
        title="Connect where you build."
      />
      <div className={styles.providerGrid}>
        {cloudProviders.map((item) => {
          const selected = item.id === state.provider;
          const connected = selected && state.connectionStatus === "connected";

          return (
            <button
              aria-pressed={selected}
              className={`${styles.providerCard} ${selected ? styles.providerCardSelected : ""}`}
              key={item.id}
              onClick={() =>
                onChange({
                  connectionStatus: item.id === state.provider ? state.connectionStatus : "idle",
                  provider: item.id,
                })
              }
              type="button"
            >
              <CloudProviderLogo provider={item.id} />
              <span className={styles.providerCopy}>
                <strong>{item.name}</strong>
                <small>{item.description}</small>
              </span>
              <span className={connected ? styles.connectedStatus : styles.providerRadio}>
                {connected ? "Connected" : selected ? "●" : ""}
              </span>
            </button>
          );
        })}
      </div>

      <div className={styles.connectionPanel}>
        <div className={styles.connectionTop}>
          <CloudProviderLogo provider={provider.id} />
          <span>
            <small>{provider.name}</small>
            <strong>
              {state.connectionStatus === "connected"
                ? "Delegated access verified"
                : `Connect with ${provider.setupLabel}`}
            </strong>
          </span>
          <span
            className={
              state.connectionStatus === "connected" ? styles.successPill : styles.securePill
            }
          >
            {state.connectionStatus === "connected" ? "Active" : "No access keys"}
          </span>
        </div>

        <ol className={styles.connectionSteps}>
          <li className={state.connectionStatus !== "idle" ? styles.connectionStepActive : ""}>
            <span>1</span>
            <p>
              <strong>Generate setup</strong>
              <small>Provisr prepares a provider-native deployment and opaque external ID.</small>
            </p>
          </li>
          <li className={state.connectionStatus !== "idle" ? styles.connectionStepActive : ""}>
            <span>2</span>
            <p>
              <strong>Install delegated identity</strong>
              <small>You approve the scoped identity inside your cloud provider.</small>
            </p>
          </li>
          <li className={state.connectionStatus === "connected" ? styles.connectionStepActive : ""}>
            <span>3</span>
            <p>
              <strong>Verify short-lived access</strong>
              <small>Provisr checks the identity and available regions without storing credentials.</small>
            </p>
          </li>
        </ol>

        {state.connectionStatus === "idle" ? (
          <button
            className={styles.secondaryButton}
            onClick={() => onChange({ connectionStatus: "guidance" })}
            type="button"
          >
            Start guided setup
            <span aria-hidden="true">→</span>
          </button>
        ) : state.connectionStatus === "guidance" ? (
          <div className={styles.verifyRow}>
            <span>
              <small>Setup reference</small>
              <strong>prv_{state.provider}_••••_8f42</strong>
            </span>
            <button
              className={styles.primaryButton}
              onClick={() => onChange({ connectionStatus: "connected" })}
              type="button"
            >
              Verify connection
            </button>
          </div>
        ) : (
          <div className={styles.connectedMessage}>
            <CheckMark />
            <span>
              <strong>{provider.name} is ready</strong>
              <small>Account access is delegated, scoped, and verified.</small>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewStep({
  state,
  workspaceCreated,
}: {
  state: FlowState;
  workspaceCreated: boolean;
}) {
  const blueprint =
    policyBlueprints.find((item) => item.id === state.blueprint) ?? policyBlueprints[0];
  const provider = cloudProviders.find((item) => item.id === state.provider) ?? cloudProviders[0];

  return (
    <div>
      <Intro
        description="Your governance foundation is ready. Nothing can execute without the required policy check, confirmation, and approval gates."
        eyebrow="Review"
        title={`Ready to open ${state.workspaceName || "your workspace"}?`}
      />
      <div className={styles.reviewLayout}>
        <div className={styles.reviewCard}>
          <div className={styles.reviewHero}>
            <span className={styles.workspaceMonogram}>
              {(state.workspaceName || "W").charAt(0).toUpperCase()}
            </span>
            <span>
              <small>WORKSPACE</small>
              <strong>{state.workspaceName || "Your workspace"}</strong>
              <p>{state.slug ? `provisr.app/${state.slug}` : "Workspace URL pending"}</p>
            </span>
            <span className={workspaceCreated ? styles.successPill : styles.previewPill}>
              {workspaceCreated ? "Created in Clerk" : "Ready"}
            </span>
          </div>
          <div className={styles.reviewRows}>
            <div>
              <span>Team</span>
              <strong>
                1 admin{state.invites.length ? ` + ${state.invites.length} invited` : ""}
              </strong>
            </div>
            <div>
              <span>Policy blueprint</span>
              <strong>{blueprint.name}</strong>
            </div>
            <div>
              <span>Cloud provider</span>
              <strong className={styles.reviewProvider}>
                <CloudProviderLogo provider={provider.id} size="sm" />
                <span>
                  {provider.name}
                  <small>
                    {state.connectionStatus === "connected" ? " · Connected" : " · Connect later"}
                  </small>
                </span>
              </strong>
            </div>
            <div>
              <span>Default context</span>
              <strong>
                {state.defaultEnvironment} · {state.defaultRegion}
              </strong>
            </div>
          </div>
        </div>

        <aside className={styles.gatesCard}>
          <span className={styles.cardKicker}>Every request follows</span>
          {["Policy context", "Validated manifest", "Terraform plan", "Policy check", "Your confirmation"].map(
            (gate, index) => (
              <div className={styles.gateRow} key={gate}>
                <span>{index + 1}</span>
                <strong>{gate}</strong>
                <CheckMark />
              </div>
            ),
          )}
          <p>Approvals are added automatically when risk, environment, policy, or cost requires them.</p>
        </aside>
      </div>
    </div>
  );
}

function FlowExperience({
  clerkEnabled,
  isAuthLoaded,
  isSignedIn,
  onCreateOrganization,
  userEmail,
  userName,
}: {
  clerkEnabled: boolean;
  isAuthLoaded: boolean;
  isSignedIn: boolean;
  onCreateOrganization?: (name: string, slug: string) => Promise<boolean>;
  userEmail?: string;
  userName?: string;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [state, setState] = useState<FlowState>(() => ({
    ...initialState,
    workspaceName: userName ? `${userName}'s workspace` : "",
    slug: userName ? normalizeSlug(`${userName}-workspace`) : "",
  }));
  const [workspaceCreated, setWorkspaceCreated] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");
  const activeStep = steps[activeIndex]?.id ?? "account";

  const currentBlueprint = useMemo(
    () => policyBlueprints.find((item) => item.id === state.blueprint),
    [state.blueprint],
  );

  useEffect(() => {
    if (!userName) {
      return;
    }

    setState((current) => {
      if (current.workspaceName || current.slug) {
        return current;
      }

      return {
        ...current,
        slug: normalizeSlug(`${userName}-workspace`),
        workspaceName: `${userName}'s workspace`,
      };
    });
  }, [userName]);

  function updateState(next: Partial<FlowState>) {
    setState((current) => ({ ...current, ...next }));
    setError("");
  }

  const canContinue = (() => {
    if (activeStep === "account") {
      return !clerkEnabled || (isAuthLoaded && isSignedIn);
    }
    if (activeStep === "workspace") {
      return state.workspaceName.trim().length >= 2 && state.slug.length >= 2;
    }
    if (activeStep === "policies") {
      return Boolean(currentBlueprint);
    }
    return true;
  })();

  async function continueFlow() {
    if (!canContinue || activeIndex >= steps.length - 1) {
      return;
    }

    if (activeStep === "workspace" && onCreateOrganization && !workspaceCreated) {
      setIsCreating(true);
      setError("");
      try {
        const created = await onCreateOrganization(state.workspaceName.trim(), state.slug);
        setWorkspaceCreated(created);
      } catch (caughtError) {
        const message =
          caughtError instanceof Error
            ? caughtError.message
            : "We could not create this workspace. Check your Clerk organization settings and try again.";
        setError(message);
        setIsCreating(false);
        return;
      }
      setIsCreating(false);
    }

    setActiveIndex((index) => Math.min(index + 1, steps.length - 1));
  }

  return (
    <main className={styles.page}>
      <div className={styles.glowOne} />
      <div className={styles.glowTwo} />
      <header className={styles.header}>
        <Brand />
        <div className={styles.headerMeta}>
          <span>Workspace setup</span>
          {clerkEnabled ? (
            <SignedIn>
              <UserButton
                appearance={{
                  elements: {
                    avatarBox: styles.clerkAvatar,
                    userButtonPopoverCard: styles.clerkPopover,
                  },
                }}
              />
            </SignedIn>
          ) : (
            <span className={styles.demoAvatar}>P</span>
          )}
        </div>
      </header>

      <div className={styles.shell}>
        <Progress activeIndex={activeIndex} onSelect={setActiveIndex} />
        <section className={styles.stage}>
          <div className={styles.stageInner}>
            {activeStep === "account" ? (
              <AccountStep
                clerkEnabled={clerkEnabled}
                userEmail={userEmail}
                userName={userName}
              />
            ) : null}
            {activeStep === "workspace" ? (
              <WorkspaceStep onChange={updateState} state={state} />
            ) : null}
            {activeStep === "team" ? (
              <TeamStep
                invites={state.invites}
                onChange={(invites) => updateState({ invites })}
              />
            ) : null}
            {activeStep === "policies" ? (
              <PoliciesStep onChange={updateState} state={state} />
            ) : null}
            {activeStep === "cloud" ? <CloudStep onChange={updateState} state={state} /> : null}
            {activeStep === "review" ? (
              <ReviewStep state={state} workspaceCreated={workspaceCreated} />
            ) : null}
          </div>

          <footer className={styles.footer}>
            <div className={styles.footerStatus}>
              {error ? (
                <span className={styles.errorMessage}>{error}</span>
              ) : (
                <span>
                  Step {activeIndex + 1} of {steps.length}
                  <small>{steps[activeIndex]?.label}</small>
                </span>
              )}
            </div>
            <div className={styles.footerActions}>
              {activeIndex > 0 ? (
                <button
                  className={styles.backButton}
                  onClick={() => setActiveIndex((index) => Math.max(index - 1, 0))}
                  type="button"
                >
                  ←
                  <span>Back</span>
                </button>
              ) : (
                <Link className={styles.backButton} href="/">
                  ←
                  <span>Back to home</span>
                </Link>
              )}

              {activeStep === "review" ? (
                <Link className={styles.primaryButton} href="/chat">
                  Open provisioning chat
                  <span aria-hidden="true">→</span>
                </Link>
              ) : (
                <button
                  className={styles.primaryButton}
                  disabled={!canContinue || isCreating}
                  onClick={continueFlow}
                  type="button"
                >
                  {isCreating ? "Creating workspace…" : activeStep === "account" ? "Continue setup" : "Continue"}
                  {!isCreating ? <span aria-hidden="true">→</span> : null}
                </button>
              )}
            </div>
          </footer>
        </section>
      </div>
    </main>
  );
}

function ClerkOnboarding() {
  const { isLoaded, isSignedIn, user } = useUser();
  const { createOrganization, setActive } = useOrganizationList();

  async function createWorkspace(name: string, slug: string) {
    if (!createOrganization || !setActive) {
      throw new Error("Clerk Organizations is still loading. Please try again.");
    }

    const organization = await createOrganization({ name, slug });
    await setActive({ organization });
    return true;
  }

  return (
    <FlowExperience
      clerkEnabled
      isAuthLoaded={isLoaded}
      isSignedIn={Boolean(isSignedIn)}
      onCreateOrganization={createWorkspace}
      userEmail={user?.primaryEmailAddress?.emailAddress}
      userName={user?.firstName || user?.fullName || undefined}
    />
  );
}

export function OnboardingFlow({ clerkEnabled }: { clerkEnabled: boolean }) {
  if (clerkEnabled) {
    return <ClerkOnboarding />;
  }

  return (
    <FlowExperience
      clerkEnabled={false}
      isAuthLoaded
      isSignedIn
    />
  );
}
