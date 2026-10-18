"use client";

import { CheckIcon, ChevronDownIcon } from "@/components/ui/icons";
import { ROLE_LABELS, type WorkspaceRole } from "@/components/layout/permissions";
import type { WorkspaceMembership } from "@/lib/orchestration/workspace-types";
import { cn } from "@/lib/cn";

const roleBadgeClasses: Record<WorkspaceRole, string> = {
  admin: "border-blue-100 bg-blue-50 text-blue-700",
  engineer: "border-green-100 bg-green-50 text-green-700",
  approver: "border-amber-100 bg-amber-50 text-amber-700",
  auditor: "border-gray-200 bg-gray-100 text-gray-600",
  viewer: "border-gray-200 bg-gray-100 text-gray-600",
};

export function WorkspaceRoleBadge({ role }: { role: WorkspaceRole }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
        roleBadgeClasses[role],
      )}
      data-testid={`role-badge-${role}`}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}

function workspaceInitial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "W";
}

type WorkspaceSwitcherProps = {
  workspaces: WorkspaceMembership[];
  activeWorkspaceId: string | null;
  collapsed?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (workspaceId: string) => void;
};

export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  collapsed = false,
  open,
  onOpenChange,
  onSelect,
}: WorkspaceSwitcherProps) {
  const active =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0] ?? null;

  const activeName = active?.name ?? "No workspace";

  return (
    <div className="relative">
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          "flex items-center gap-2 rounded-lg border border-gray-200 bg-white text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100",
          collapsed ? "size-9 justify-center" : "w-full px-2 py-2",
        )}
        data-testid="workspace-switcher-trigger"
        onClick={() => onOpenChange(!open)}
        title={collapsed ? activeName : undefined}
        type="button"
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-blue-50 text-[10px] font-bold text-blue-500">
          {workspaceInitial(activeName)}
        </span>
        {collapsed ? null : (
          <>
            <span className="min-w-0 flex-1">
              <span
                className="block truncate text-xs font-semibold text-gray-800"
                data-testid="workspace-switcher-name"
              >
                {activeName}
              </span>
              {active ? (
                <span className="mt-0.5 block">
                  <WorkspaceRoleBadge role={active.role} />
                </span>
              ) : null}
            </span>
            <ChevronDownIcon className="size-4 shrink-0 text-gray-400" />
          </>
        )}
      </button>

      {open && !collapsed ? (
        <div
          className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-md"
          data-testid="workspace-switcher-menu"
          role="menu"
        >
          {workspaces.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-500">No workspaces yet.</div>
          ) : (
            workspaces.map((workspace) => {
              const isActive = workspace.id === active?.id;
              return (
                <button
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-gray-50"
                  data-testid={`workspace-option-${workspace.slug}`}
                  key={workspace.id}
                  onClick={() => {
                    onSelect(workspace.id);
                    onOpenChange(false);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-gray-100 text-[10px] font-bold text-gray-600">
                    {workspaceInitial(workspace.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-gray-800">
                      {workspace.name}
                    </span>
                    <span className="mt-0.5 block">
                      <WorkspaceRoleBadge role={workspace.role} />
                    </span>
                  </span>
                  {isActive ? <CheckIcon className="size-4 shrink-0 text-blue-500" /> : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
