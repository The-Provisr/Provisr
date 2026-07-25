import {
  FolderKanbanIcon,
  HeadphonesIcon,
  LayoutGridIcon,
  MessageSquareIcon,
  SunIcon,
  TerminalSquareIcon,
  UsersIcon,
  ZapIcon,
} from "@/components/ui/icons";
import { IconButton } from "@/components/ui/icon-button";

const navItems = [
  { label: "Chat", icon: MessageSquareIcon, active: true },
  { label: "Support", icon: HeadphonesIcon },
  { label: "Automations", icon: ZapIcon },
  { label: "Apps", icon: LayoutGridIcon },
  { label: "Projects", icon: FolderKanbanIcon },
  { label: "Terminal", icon: TerminalSquareIcon },
  { label: "Team", icon: UsersIcon, indicator: true },
];

export function NavigationRail() {
  return (
    <nav className="hidden w-16 shrink-0 flex-col items-center border-r border-gray-100 bg-white py-4 md:flex">
      <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-white shadow-sm">
        <span className="sr-only">Provisr</span>
      </div>

      <div className="flex flex-col items-center gap-6 pt-4">
        {navItems.map((item) => {
          const Icon = item.icon;

          return (
            <IconButton active={item.active} key={item.label} label={item.label}>
              <Icon className="size-5" />
              {item.indicator ? (
                <span className="absolute right-1 top-1 size-2.5 rounded-full border-2 border-white bg-blue-500" />
              ) : null}
            </IconButton>
          );
        })}
      </div>

      <div className="mt-auto flex flex-col items-center gap-6 pb-2">
        <IconButton label="Theme">
          <SunIcon className="size-5" />
        </IconButton>
        <div className="flex size-8 items-center justify-center rounded-full border border-green-200 bg-green-100 text-xs font-bold text-green-700">
          S
        </div>
      </div>
    </nav>
  );
}
