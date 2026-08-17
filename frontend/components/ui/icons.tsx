import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function IconBase({ children, className, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
      {...props}
    >
      {children}
    </svg>
  );
}

export function MessageSquareIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M22 17a2 2 0 0 1-2 2H6.8a2 2 0 0 0-1.4.6l-2.2 2.2A.7.7 0 0 1 2 21.3V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
    </IconBase>
  );
}

export function HeadphonesIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />
    </IconBase>
  );
}

export function ZapIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 14a1 1 0 0 1-.8-1.6l9.9-10.2a.5.5 0 0 1 .9.5L12.1 8.7A1 1 0 0 0 13 10h7a1 1 0 0 1 .8 1.6l-9.9 10.2a.5.5 0 0 1-.9-.5l1.9-6A1 1 0 0 0 11 14z" />
    </IconBase>
  );
}

export function LayoutGridIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
    </IconBase>
  );
}

export function GaugeIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 14a8 8 0 1 1 16 0" />
      <path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
      <path d="m12 14 3-4" />
      <path d="M8 14h.01M16 14h.01" />
    </IconBase>
  );
}

export function ClipboardListIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect width="16" height="18" x="4" y="4" rx="2" />
      <path d="M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1Z" />
      <path d="M8 10h.01M11 10h5M8 14h.01M11 14h5M8 18h.01M11 18h4" />
    </IconBase>
  );
}

export function ShieldCheckIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-5" />
    </IconBase>
  );
}

export function ServerStackIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect width="18" height="6" x="3" y="3" rx="2" />
      <rect width="18" height="6" x="3" y="15" rx="2" />
      <path d="M7 6h.01M7 18h.01M11 6h6M11 18h6" />
    </IconBase>
  );
}

export function ScrollTextIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M8 21h8a3 3 0 0 0 3-3V5a3 3 0 0 0-3-3H7a2 2 0 0 0-2 2v14a3 3 0 0 0 3 3Z" />
      <path d="M5 18a3 3 0 0 1 3-3h11" />
      <path d="M9 7h6M9 11h5" />
    </IconBase>
  );
}

export function FolderKanbanIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
      <path d="M8 10v4" />
      <path d="M12 10v2" />
      <path d="M16 10v6" />
    </IconBase>
  );
}

export function TerminalSquareIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m7 11 2-2-2-2" />
      <path d="M11 13h4" />
      <rect width="18" height="18" x="3" y="3" rx="2" />
    </IconBase>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <path d="M16 3.1a4 4 0 0 1 0 7.8" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.9" />
      <circle cx="9" cy="7" r="4" />
    </IconBase>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4" />
    </IconBase>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m21 21-4.3-4.3" />
      <circle cx="11" cy="11" r="8" />
    </IconBase>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 12h14M12 5v14" />
    </IconBase>
  );
}

export function SparklesIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M11 2.8a1 1 0 0 1 2 0l1 5.6a2 2 0 0 0 1.6 1.6l5.6 1a1 1 0 0 1 0 2l-5.6 1a2 2 0 0 0-1.6 1.6l-1 5.6a1 1 0 0 1-2 0l-1-5.6A2 2 0 0 0 8.4 14l-5.6-1a1 1 0 0 1 0-2l5.6-1A2 2 0 0 0 10 8.4z" />
    </IconBase>
  );
}

export function StarIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m12 2.3 2.3 4.7a2.1 2.1 0 0 0 1.6 1.2l5.2.8a.5.5 0 0 1 .3.9l-3.8 3.6a2.1 2.1 0 0 0-.6 1.9l.9 5.1a.5.5 0 0 1-.8.6L12.5 18.6a2.1 2.1 0 0 0-2 0L5.9 21a.5.5 0 0 1-.8-.6l.9-5.1a2.1 2.1 0 0 0-.6-1.9L1.6 9.8a.5.5 0 0 1 .3-.9l5.2-.8A2.1 2.1 0 0 0 8.7 7z" />
    </IconBase>
  );
}

export function MoreHorizontalIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </IconBase>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m6 9 6 6 6-6" />
    </IconBase>
  );
}

export function ImageIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
    </IconBase>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12.2 2h-.4a2 2 0 0 0-2 1.7l-.1.8a2 2 0 0 1-1 1.4l-.7.4a2 2 0 0 1-1.8.1l-.7-.3a2 2 0 0 0-2.5.9l-.2.4a2 2 0 0 0 .4 2.6l.6.5a2 2 0 0 1 0 3l-.6.5a2 2 0 0 0-.4 2.6l.2.4a2 2 0 0 0 2.5.9l.7-.3a2 2 0 0 1 1.8.1l.7.4a2 2 0 0 1 1 1.4l.1.8a2 2 0 0 0 2 1.7h.4a2 2 0 0 0 2-1.7l.1-.8a2 2 0 0 1 1-1.4l.7-.4a2 2 0 0 1 1.8-.1l.7.3a2 2 0 0 0 2.5-.9l.2-.4a2 2 0 0 0-.4-2.6l-.6-.5a2 2 0 0 1 0-3l.6-.5a2 2 0 0 0 .4-2.6l-.2-.4a2 2 0 0 0-2.5-.9l-.7.3a2 2 0 0 1-1.8-.1l-.7-.4a2 2 0 0 1-1-1.4l-.1-.8a2 2 0 0 0-2-1.7Z" />
      <circle cx="12" cy="12" r="3" />
    </IconBase>
  );
}

export function UploadIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3v12" />
      <path d="m17 8-5-5-5 5" />
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    </IconBase>
  );
}

export function VolumeIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6a1.4 1.4 0 0 1-1 .4H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z" />
      <path d="M16 9a5 5 0 0 1 0 6" />
      <path d="M19.4 18.4a9 9 0 0 0 0-12.8" />
    </IconBase>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect width="14" height="14" x="8" y="8" rx="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </IconBase>
  );
}

export function ThumbsDownIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M9 18.1 10 14H4.2a2 2 0 0 1-1.9-2.6l2.3-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.8a2 2 0 0 0-1.8 1.1L12 22a3.1 3.1 0 0 1-3-3.9Z" />
      <path d="M17 14V2" />
    </IconBase>
  );
}

export function RotateCcwIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 12a9 9 0 1 0 9-9 9.8 9.8 0 0 0-6.7 2.7L3 8" />
      <path d="M3 3v5h5" />
    </IconBase>
  );
}

export function LinkIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M9 17H7A5 5 0 0 1 7 7h2" />
      <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
      <path d="M8 12h8" />
    </IconBase>
  );
}

export function MicIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <path d="M12 19v3" />
    </IconBase>
  );
}

export function ArrowUpIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m5 12 7-7 7 7" />
      <path d="M12 19V5" />
    </IconBase>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m15 6-6 6 6 6" />
    </IconBase>
  );
}

export function DatabaseIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14a9 3 0 0 0 18 0V5" />
      <path d="M3 12a9 3 0 0 0 18 0" />
    </IconBase>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m9 6 6 6-6 6" />
    </IconBase>
  );
}

export function HardDriveIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <line x1="22" x2="2" y1="12" y2="12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      <line x1="6" x2="6.01" y1="16" y2="16" />
      <line x1="10" x2="10.01" y1="16" y2="16" />
    </IconBase>
  );
}

export function SaveIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
      <path d="M17 21v-8H7v8" />
      <path d="M7 3v5h8" />
    </IconBase>
  );
}

export function NetworkIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="16" y="16" width="6" height="6" rx="1" />
      <rect x="2" y="16" width="6" height="6" rx="1" />
      <rect x="9" y="2" width="6" height="6" rx="1" />
      <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" />
      <path d="M12 12V8" />
    </IconBase>
  );
}

export function TuneIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
      <circle cx="9" cy="6" r="2" />
      <circle cx="15" cy="12" r="2" />
      <circle cx="9" cy="18" r="2" />
    </IconBase>
  );
}

export function EditIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </IconBase>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect width="18" height="11" x="3" y="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </IconBase>
  );
}

export function ExternalLinkIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </IconBase>
  );
}

export function RuleIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 3h16a1 1 0 0 1 1 1v5a2 2 0 0 0 0 6v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5a2 2 0 0 0 0-6V4a1 1 0 0 1 1-1Z" />
      <path d="M8.5 9.5 11 12l4.5-5" />
    </IconBase>
  );
}

export function BracesIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M8 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1" />
      <path d="M16 3h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1" />
    </IconBase>
  );
}

export function AlertTriangleIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </IconBase>
  );
}
