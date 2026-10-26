"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, LogOutIcon, SettingsIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return `${parts[0]!.slice(0, 1)}${parts[parts.length - 1]!.slice(0, 1)}`.toUpperCase();
}

/**
 * FE-M03 user menu. Requires Clerk context, so it is only rendered when a
 * publishable key is configured; otherwise `AccountCard` is used instead.
 */
export function UserMenu({ collapsed = false }: { collapsed?: boolean }) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const name =
    user?.fullName ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress ||
    "Account";
  const email = user?.primaryEmailAddress?.emailAddress ?? "";

  return (
    <div className="relative" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          "flex items-center gap-2 rounded-lg text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100",
          collapsed ? "size-9 justify-center" : "w-full px-2 py-1.5",
        )}
        data-testid="user-menu-trigger"
        onClick={() => setOpen((value) => !value)}
        title={collapsed ? name : undefined}
        type="button"
      >
        <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-green-200 bg-green-100 text-[10px] font-bold text-green-700">
          {user?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="" className="size-full object-cover" src={user.imageUrl} />
          ) : (
            initials(name)
          )}
        </span>
        {collapsed ? null : (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold text-gray-800">{name}</span>
              {email ? (
                <span className="block truncate text-[10px] text-gray-400">{email}</span>
              ) : null}
            </span>
            <ChevronDownIcon className="size-4 shrink-0 text-gray-400" />
          </>
        )}
      </button>

      {open ? (
        <div
          className="absolute bottom-full left-0 z-20 mb-1 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-md"
          data-testid="user-menu"
          role="menu"
        >
          <div className="px-3 py-2">
            <div className="truncate text-xs font-semibold text-gray-800">{name}</div>
            {email ? <div className="truncate text-[10px] text-gray-400">{email}</div> : null}
          </div>
          <Link
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
            href="/settings"
            onClick={() => setOpen(false)}
            role="menuitem"
          >
            <SettingsIcon className="size-4" />
            Settings
          </Link>
          <button
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-gray-600 hover:bg-gray-50"
            onClick={() => {
              setOpen(false);
              void signOut({ redirectUrl: "/" });
            }}
            role="menuitem"
            type="button"
          >
            <LogOutIcon className="size-4" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Fallback shown when Clerk is not configured (local/no-auth demos). */
export function AccountCard({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg",
        collapsed ? "size-9 justify-center" : "w-full px-2 py-1.5",
      )}
      data-testid="account-card"
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-green-200 bg-green-100 text-[10px] font-bold text-green-700">
        P
      </span>
      {collapsed ? null : (
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-gray-800">Provisr</span>
          <span className="block truncate text-[10px] text-gray-400">Not signed in</span>
        </span>
      )}
    </div>
  );
}
