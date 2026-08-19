"use client";

import { cn } from "@/lib/cn";

type ToastTone = "success" | "error";

type ToastProps = {
  message: string;
  tone?: ToastTone;
  onDismiss?: () => void;
};

const toneClasses: Record<ToastTone, { card: string; icon: string }> = {
  success: { card: "border-green-200 bg-green-50 text-green-900", icon: "bg-green-200 text-green-900" },
  error: { card: "border-red-200 bg-red-50 text-red-900", icon: "bg-red-200 text-red-900" },
};

export function Toast({ message, tone = "success", onDismiss }: ToastProps) {
  const classes = toneClasses[tone];
  return (
    <div
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={cn("fixed bottom-4 right-4 z-50 flex max-w-sm items-center gap-3 rounded-lg border p-4 shadow-sm", classes.card)}
      data-testid="toast"
      role={tone === "error" ? "alert" : "status"}
    >
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold", classes.icon)}>
        {tone === "success" ? "✓" : "!"}
      </span>
      <p className="flex-1 text-sm font-medium">{message}</p>
      {onDismiss ? (
        <button
          aria-label="Dismiss notification"
          className="text-xs font-semibold uppercase tracking-wider opacity-70 hover:opacity-100"
          onClick={onDismiss}
          type="button"
        >
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

export type { ToastProps, ToastTone };