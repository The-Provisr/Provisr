"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  canAccessScreen,
  type WorkspaceRole,
} from "@/components/layout/permissions";
import {
  PRIMARY_NAV,
  SECONDARY_NAV,
  isNavItemActive,
  type NavItem,
} from "@/components/layout/nav-config";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { AccountCard, UserMenu } from "@/components/layout/user-menu";
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";
import {
  BellIcon,
  PanelLeftIcon,
  SearchIcon,
} from "@/components/ui/icons";
import type { WorkspaceMembership } from "@/lib/orchestration/workspace-types";
import { cn } from "@/lib/cn";

const COLLAPSED_STORAGE_KEY = "provisr-sidebar-collapsed";
const EXPANDED_WIDTH = 240;
const COLLAPSED_WIDTH = 64;

type DashboardShellProps = {
  children: ReactNode;
  sidebar?: ReactNode;
  clerkEnabled: boolean;
};

export function DashboardShell({ children, sidebar, clerkEnabled }: DashboardShellProps) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceMembership[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);

  const [listAttempt, setListAttempt] = useState(0);
  const [listStatus, setListStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [switching, setSwitching] = useState(false);
  const switchingRef = useRef(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  useEffect(() => {
    if (window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === "true") {
      setCollapsed(true);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setListStatus("loading");
      try {
        const res = await fetch("/api/workspace/list", { cache: "no-store" });
        if (!res.ok) throw new Error("Workspace listing failed");
        const body = (await res.json()) as {
          workspaces?: WorkspaceMembership[];
          activeWorkspaceId?: string | null;
          degraded?: boolean;
        };
        if (body.degraded || !Array.isArray(body.workspaces)) {
          throw new Error("Workspace listing unavailable");
        }
        if (cancelled) return;
        if (Array.isArray(body.workspaces)) setWorkspaces(body.workspaces);
        setActiveWorkspaceId(body.activeWorkspaceId ?? null);
        setListStatus("ready");
      } catch {
        if (cancelled) return;
        setWorkspaces([]);
        setActiveWorkspaceId(null);
        setListStatus("failed");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [listAttempt]);

  async function selectWorkspace(workspaceId: string) {
    if (switchingRef.current || workspaceId === activeWorkspaceId) return;
    if (!workspaces.some((workspace) => workspace.id === workspaceId)) return;
    switchingRef.current = true;
    setSwitching(true);
    setSwitchError(null);
    try {
      const res = await fetch("/api/workspace/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error("Workspace selection failed");
      const body = await res.json();
      if (body.workspaceId !== workspaceId) throw new Error("Workspace selection mismatch");
      // Existing handoff refreshes Clerk's token and verifies the saved claim
      // before mounting fresh dashboard/page streams for the new workspace.
      router.push("/post-auth");
    } catch {
      setSwitchError("Could not switch workspace. Please retry.");
      switchingRef.current = false;
      setSwitching(false);
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((value) => !value);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setSwitcherOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  const role: WorkspaceRole | null = activeWorkspace?.role ?? null;

  const renderNavItem = (item: NavItem) => {
    const Icon = item.icon;
    const active = isNavItemActive(item, pathname);
    return (
      <Link
        aria-label={item.label}
        className={cn(
          "flex items-center gap-3 rounded-lg text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100",
          collapsed ? "size-9 justify-center" : "px-3 py-2",
          active
            ? "bg-blue-50 text-blue-600"
            : "text-gray-500 hover:bg-gray-50 hover:text-gray-800",
        )}
        data-testid={`nav-${item.screen}`}
        href={item.href}
        key={item.screen}
        title={collapsed ? item.label : undefined}
      >
        <Icon className="size-4 shrink-0" />
        {collapsed ? null : <span className="truncate">{item.label}</span>}
      </Link>
    );
  };

  const visiblePrimary = PRIMARY_NAV.filter((item) => canAccessScreen(role, item.screen));
  const visibleSecondary = SECONDARY_NAV.filter((item) => canAccessScreen(role, item.screen));

  return (
    <main className="flex h-screen overflow-hidden bg-gray-50 font-sans text-gray-800">
      <aside
        className="flex shrink-0 flex-col border-r border-gray-100 bg-white p-3"
        data-collapsed={collapsed}
        data-testid="dashboard-sidebar"
        style={{ width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH }}
      >
        <div className="flex items-center justify-between gap-2">
          {collapsed ? null : (
            <Link
              className="flex items-center gap-2 px-1 text-sm font-bold text-gray-900"
              href="/dashboard"
            >
              <img alt="" height={24} src="/logo.png" width={24} />
              Provisr
            </Link>
          )}
          <button
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={collapsed}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100"
            data-testid="sidebar-collapse-toggle"
            onClick={() => setCollapsed((value) => !value)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            type="button"
          >
            <PanelLeftIcon className="size-5" />
          </button>
        </div>

        <div className="mt-3">
          <WorkspaceSwitcher
            activeWorkspaceId={activeWorkspaceId}
            collapsed={collapsed}
            onOpenChange={setSwitcherOpen}
            onSelect={(workspaceId) => void selectWorkspace(workspaceId)}
            disabled={switching}
            open={switcherOpen}
            workspaces={workspaces}
          />
          {listStatus === "loading" ? <p role="status" className="text-xs text-gray-500">Loading workspaces…</p> : null}
          {listStatus === "failed" ? (
            <div role="alert" className="text-xs text-gray-500">
              Workspaces unavailable.
              <button type="button" onClick={() => setListAttempt((value) => value + 1)}>Retry</button>
            </div>
          ) : null}
          {switching ? <p role="status" className="text-xs text-gray-500">Switching workspace…</p> : null}
          {switchError ? <p role="alert" className="text-xs text-gray-500">{switchError}</p> : null}
        </div>

        <button
          className={cn(
            "mt-2 flex items-center gap-2 rounded-lg border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100",
            collapsed ? "size-9 justify-center" : "w-full px-2 py-2 text-xs",
          )}
          data-testid="global-search"
          onClick={() => setSearchOpen(true)}
          title="Global search (⌘K) — coming soon"
          type="button"
        >
          <SearchIcon className="size-4 shrink-0" />
          {collapsed ? null : (
            <>
              <span className="flex-1 text-left">Search…</span>
              <kbd className="rounded border border-gray-200 px-1 text-[10px] text-gray-400">⌘K</kbd>
            </>
          )}
        </button>

        <nav className="mt-3 flex flex-1 flex-col gap-1" aria-label="Primary">
          {visiblePrimary.map(renderNavItem)}
        </nav>

        <nav className="flex flex-col gap-1 border-t border-gray-100 pt-2" aria-label="Secondary">
          {visibleSecondary.map(renderNavItem)}
        </nav>

        <div className="mt-2 flex flex-col gap-1 border-t border-gray-100 pt-2">
          <button
            aria-label="Notifications"
            className={cn(
              "flex items-center gap-3 rounded-lg text-xs font-medium text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100",
              collapsed ? "size-9 justify-center" : "px-3 py-2",
            )}
            data-testid="notifications"
            title="Notifications — coming soon"
            type="button"
          >
            <BellIcon className="size-4 shrink-0" />
            {collapsed ? null : <span>Notifications</span>}
          </button>
          <ThemeToggle collapsed={collapsed} />
          {clerkEnabled ? <UserMenu collapsed={collapsed} /> : <AccountCard collapsed={collapsed} />}
        </div>
      </aside>

      {sidebar}

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white">
        {children}
      </section>

      {searchOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-8"
          onClick={() => setSearchOpen(false)}
          role="presentation"
        >
          <div
            aria-label="Global search"
            className="w-full max-w-[480px] rounded-xl border border-gray-200 bg-white p-4 shadow-md"
            data-testid="search-panel"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <p className="text-sm font-semibold text-gray-900">Global search</p>
            <p className="mt-1 text-xs text-gray-500">
              Cross-workspace search is coming soon. For now, use the Chat to ask
              about your infrastructure.
            </p>
          </div>
        </div>
      ) : null}
    </main>
  );
}
