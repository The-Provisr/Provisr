import type { ReactNode } from "react";

type MessageBubbleProps = {
  children: ReactNode;
};

export function MessageBubble({ children }: MessageBubbleProps) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-3xl bg-gray-100 px-6 py-3 text-sm text-gray-800">
        {children}
      </div>
    </div>
  );
}
