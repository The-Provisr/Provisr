import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  children: ReactNode;
  label: string;
};

export function IconButton({
  active = false,
  children,
  className,
  label,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      aria-label={label}
      className={cn(
        "relative inline-flex size-9 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100",
        active
          ? "bg-gray-100 text-white"
          : "text-gray-400 hover:bg-gray-100 hover:text-gray-600",
        className,
      )}
      title={label}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}
