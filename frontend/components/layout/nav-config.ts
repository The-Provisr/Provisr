import type { ComponentType, SVGProps } from "react";
import {
  CreditCardIcon,
  GaugeIcon,
  HardDriveIcon,
  MessageSquareIcon,
  RuleIcon,
  ScrollTextIcon,
  ServerStackIcon,
  ShieldCheckIcon,
  UsersIcon,
} from "@/components/ui/icons";
import type { NavScreen } from "@/components/layout/permissions";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export type NavItem = {
  label: string;
  href: string;
  icon: IconComponent;
  screen: NavScreen;
  /** Extra path prefixes that should mark this item active. */
  match?: string[];
};

/**
 * FE-M03 primary navigation. Order is fixed by the FE-A03 design.
 * Hrefs point at routes that exist today; screens not yet built render the
 * `ComingSoon` placeholder so adding them later never has to touch navigation.
 */
export const PRIMARY_NAV: readonly NavItem[] = [
  { label: "Chat", href: "/chat", icon: MessageSquareIcon, screen: "chat" },
  { label: "Dashboard", href: "/dashboard", icon: GaugeIcon, screen: "dashboard" },
  {
    label: "Cloud Accounts",
    href: "/workspace/cloud-accounts",
    icon: ServerStackIcon,
    screen: "cloud_accounts",
  },
  { label: "Team", href: "/workspace/team", icon: UsersIcon, screen: "team" },
  { label: "Policy", href: "/policy", icon: RuleIcon, screen: "policy" },
];

/** FE-M03 secondary navigation. */
export const SECONDARY_NAV: readonly NavItem[] = [
  {
    label: "Approvals",
    href: "/approvals",
    icon: ShieldCheckIcon,
    screen: "approvals",
  },
  { label: "Resources", href: "/resources", icon: HardDriveIcon, screen: "resources" },
  { label: "Audit", href: "/audit", icon: ScrollTextIcon, screen: "audit" },
  {
    label: "Billing",
    href: "/workspace/billing",
    icon: CreditCardIcon,
    screen: "billing",
  },
];

export const ALL_NAV_ITEMS: readonly NavItem[] = [...PRIMARY_NAV, ...SECONDARY_NAV];

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  const paths = item.match ?? [item.href];
  return paths.some((path) =>
    item.href === "/dashboard" || item.href === "/chat"
      ? pathname === path
      : pathname === path || pathname.startsWith(`${path}/`),
  );
}
