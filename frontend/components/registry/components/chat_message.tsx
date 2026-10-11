import { z } from "zod";
import { defaultRegistry } from "../registry";

export const chatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  senderName: z.string().optional(),
  createdAt: z.string().optional(),
  status: z.enum(["sending", "sent", "complete", "failed"]).optional(),
  toolSummary: z
    .object({
      toolName: z.string(),
      durationMs: z.number().optional(),
      result: z.string().optional(),
    })
    .optional(),
});

export type ChatMessageData = z.infer<typeof chatMessageSchema>;

export function ChatMessageComponent({ data }: { data: ChatMessageData }) {
  const isUser = data.role === "user";

  return (
    <div className={`flex flex-col gap-1.5 ${isUser ? "items-end" : "items-start"}`}>
      <div className="flex items-center gap-2 text-xs text-gray-500">
        {data.senderName ? <span className="font-semibold text-gray-700">{data.senderName}</span> : null}
        {data.createdAt ? <span>{data.createdAt}</span> : null}
        {data.status ? (
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-gray-600">
            {data.status}
          </span>
        ) : null}
      </div>

      <div
        className={`max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed shadow-xs ${
          isUser
            ? "bg-gray-900 text-white"
            : "border border-gray-100 bg-white text-gray-800"
        }`}
      >
        <p className="whitespace-pre-wrap">{data.content}</p>

        {data.toolSummary ? (
          <div className="mt-2.5 rounded-md border border-gray-100 bg-gray-50/75 p-2 text-xs text-gray-600">
            <div className="flex items-center justify-between font-mono font-medium text-gray-700">
              <span>{data.toolSummary.toolName}</span>
              {data.toolSummary.durationMs ? <span>{data.toolSummary.durationMs}ms</span> : null}
            </div>
            {data.toolSummary.result ? <p className="mt-1 text-gray-500">{data.toolSummary.result}</p> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

defaultRegistry.register({
  type: "chat_message",
  version: "1.0",
  schema: chatMessageSchema,
  component: ChatMessageComponent,
});
