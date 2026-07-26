"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CopyIcon,
  FolderKanbanIcon,
  LayoutGridIcon,
  MessageSquareIcon,
  SettingsIcon,
  SunIcon,
  UsersIcon,
  ZapIcon,
} from "@/components/ui/icons";
import { cn } from "@/lib/cn";

const navItems = [
  { label: "Provisioning Chat", href: "/chat", icon: MessageSquareIcon },
  {
    label: "Workspace Dashboard",
    href: "/workspace",
    icon: LayoutGridIcon,
    match: ["/workspace", "/policy"],
  },
  { label: "Requests", href: "/requests", icon: FolderKanbanIcon },
  { label: "Approvals", href: "/approvals", icon: UsersIcon, indicator: true },
  { label: "Resources", href: "/resources", icon: ZapIcon },
  { label: "Audit Log", href: "/audit", icon: CopyIcon },
  { label: "Settings", href: "/settings", icon: SettingsIcon },
];

export function NavigationRail() {
  const pathname = usePathname();

  return (
    <nav className="hidden w-16 shrink-0 flex-col items-center border-r border-gray-100 bg-white py-4 md:flex">
      <Link
        aria-label="Provisr chat"
        className="mb-2 flex size-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-white shadow-sm"
        href="/chat"
      >
        <span className="sr-only">Provisr</span>
      </Link>

      <div className="flex flex-col items-center gap-6 pt-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = item.match
            ? item.match.some((path) => pathname.startsWith(path))
            : item.href === "/chat"
              ? pathname === item.href
              : pathname.startsWith(item.href);

          return (
            <Link
              aria-label={item.label}
              className={cn(
                "relative inline-flex size-9 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100",
                active
                  ? "bg-slate-900 text-white"
                  : "text-gray-400 hover:bg-gray-100 hover:text-gray-600",
              )}
              href={item.href}
              key={item.label}
              title={item.label}
            >
              <Icon className="size-5" />
              {item.indicator ? (
                <span className="absolute right-1 top-1 size-2.5 rounded-full border-2 border-white bg-blue-500" />
              ) : null}
            </Link>
          );
        })}
      </div>

      <div className="mt-auto flex flex-col items-center gap-6 pb-2">
        <button
          aria-label="Theme"
          className="relative inline-flex size-9 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100"
          title="Theme"
          type="button"
        >
          <SunIcon className="size-5" />
        </button>
        <div className="flex size-8 items-center justify-center rounded-full border border-green-200 bg-green-100 text-xs font-bold text-green-700">
          S
        </div>
      </div>
    </nav>
  );
}
