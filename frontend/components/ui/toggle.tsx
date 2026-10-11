import type { ButtonHTMLAttributes, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { cn } from "@/lib/cn";

type ToggleProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onChange" | "onClick" | "onKeyDown"
> & {
  checked: boolean;
  disabled?: boolean;
  label?: string;
  onChange?: (checked: boolean) => void;
  onClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
};

export function Toggle({
  checked,
  disabled,
  label,
  onChange,
  onClick,
  onKeyDown,
  className,
  ...props
}: ToggleProps) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 cursor-pointer select-none items-center rounded-full border-gray-200 transition-colors",
        "provisr-toggle",
        checked && "provisr-toggle-on",
        disabled && "cursor-not-allowed opacity-70",
        className,
      )}
      disabled={disabled}
      onClick={(event) => {
        onClick?.(event);
        event.stopPropagation();
        onChange?.(!checked);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.key === "Enter" || event.key === " ") {
          event.stopPropagation();
        }
      }}
      role="switch"
      type="button"
      {...props}
    >
      <span className="provisr-toggle-dot" />
    </button>
  );
}