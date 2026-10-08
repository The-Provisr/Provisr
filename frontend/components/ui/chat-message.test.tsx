import type { ComponentPayload, ComponentType } from "@provisr/shared-contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RegistryProvider } from "@/components/registry/RegistryProvider";
import { ChatMessage } from "@/components/ui/chat-message";
import type { ChatMessageItem } from "@/lib/chat/chat-message-types";

const base: ChatMessageItem = {
  id: "m1",
  runId: "run-1",
  role: "assistant",
  content: "Hello **world**",
  status: "complete",
  createdAt: "2026-08-08T12:00:00Z",
};

function renderMessage(message: ChatMessageItem, props?: { onRetry?: (id: string) => void }) {
  return render(<ChatMessage message={message} onRetry={props?.onRetry} />);
}

describe("ChatMessage", () => {
  it("renders the user message right-aligned with initials avatar and timestamp", () => {
    const { container } = renderMessage({
      ...base,
      id: "u1",
      role: "user",
      content: "Deploy an ECS web app",
      status: "sent",
      createdAt: new Date().toISOString(),
      senderName: "Malsha De Alwis",
    });
    expect(container.firstElementChild?.className).toContain("justify-end");
    expect(screen.getByText("Deploy an ECS web app")).toBeInTheDocument();
    expect(screen.getByText("MD")).toBeInTheDocument();
    expect(screen.getByText("just now")).toBeInTheDocument();
  });

  it("renders the assistant message left-aligned with markdown", () => {
    const { container } = renderMessage(base);
    expect(container.firstElementChild?.className).toContain("justify-start");
    const strong = screen.getByText("world");
    expect(strong.tagName).toBe("STRONG");
  });

  it("renders links from markdown", () => {
    renderMessage({ ...base, content: "See [the plan](https://example.com)" });
    const link = screen.getByRole("link", { name: "the plan" });
    expect(link).toHaveAttribute("href", "https://example.com");
  });

  it("shows the streaming cursor only while streaming", () => {
    const streaming = renderMessage({ ...base, status: "streaming" });
    expect(screen.getByTestId("streaming-cursor")).toBeInTheDocument();
    expect(streaming.queryByTestId("streaming-cursor")).not.toBeNull();
  });

  it("hides the streaming cursor once complete", () => {
    renderMessage(base);
    expect(screen.queryByTestId("streaming-cursor")).toBeNull();
  });

  it("applies the sending opacity to user messages", () => {
    const { container } = renderMessage({
      ...base,
      id: "u3",
      role: "user",
      content: "Sending",
      status: "sending",
      createdAt: new Date().toISOString(),
    });
    expect(container.firstElementChild?.className).toContain("opacity-70");
  });

  it("renders the error state with retry callback", () => {
    const onRetry = vi.fn();
    renderMessage(
      { ...base, status: "error", errorMessage: "Agent timed out" },
      { onRetry },
    );
    expect(screen.getByText("Agent timed out")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry message m1" }));
    expect(onRetry).toHaveBeenCalledWith("m1");
  });

  it("does not render the retry button without onRetry", () => {
    renderMessage({ ...base, status: "error", errorMessage: "Agent timed out" });
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("collapses the tool summary until toggled", () => {
    renderMessage({
      ...base,
      toolSummary: {
        toolName: "policy.check",
        durationMs: 1240,
        result: "3/3 policies satisfied",
      },
    });
    expect(screen.getByText("policy.check · 1.2s")).toBeInTheDocument();
    expect(screen.queryByText("3/3 policies satisfied")).toBeNull();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("3/3 policies satisfied")).toBeInTheDocument();
  });

  it("falls back to a safe card when no registry renderer is provided", () => {
    const payload: ComponentPayload = {
      type: "cost_estimate",
      version: "1.0.0",
      requestId: "req-1",
      data: { estimatedMonthlyUsd: 482 },
    };
    renderMessage({ ...base, components: [payload] });
    expect(screen.getByText("cost_estimate")).toBeInTheDocument();
    expect(screen.getByText("version 1.0.0")).toBeInTheDocument();
  });

  it("dispatches component payloads to the registry renderer when provided", () => {
    const payload: ComponentPayload = {
      type: "cost_estimate",
      version: "1.0.0",
      requestId: "req-1",
      data: { estimatedMonthlyUsd: 482 },
    };
    const renderComponent = vi.fn(() => <div>registry card</div>);
    render(
      <ChatMessage
        message={{ ...base, components: [payload] }}
        renderComponent={renderComponent}
      />,
    );
    expect(renderComponent).toHaveBeenCalledWith(payload);
    expect(screen.getByText("registry card")).toBeInTheDocument();
  });

  it("renders the system message centered and muted", () => {
    const { container } = renderMessage({
      ...base,
      id: "s1",
      role: "system",
      content: "Policy check passed",
    });
    expect(container.firstElementChild?.className).toContain("justify-center");
    expect(screen.getByText("Policy check passed")).toBeInTheDocument();
  });

  it("shows user attachments with size", () => {
    renderMessage({
      ...base,
      id: "u2",
      role: "user",
      content: "Here is my spec",
      attachments: [{ name: "spec.pdf", sizeBytes: 2048 }],
    });
    expect(screen.getByText("spec.pdf · 2.0 KB")).toBeInTheDocument();
  });

  it("preserves run context across in-place updates", () => {
    const { rerender } = render(<ChatMessage message={base} />);
    rerender(
      <ChatMessage
        message={{ ...base, status: "streaming", content: "Hello **world** with more" }}
      />,
    );
    expect(screen.getAllByText(/Hello/)).toHaveLength(1);
    expect(screen.getAllByText(/world/).length).toBeGreaterThanOrEqual(1);
  });

  it("renders the registered component card when a registry provider is present", () => {
    const payload: ComponentPayload = {
      type: "cost_estimate",
      version: "1.0",
      requestId: "req-1",
      data: {
        currency: "USD",
        monthlyTotalUsd: 482,
        breakdown: [{ category: "Compute", serviceName: "ECS Fargate tasks", costUsd: 482 }],
      },
    };
    render(
      <RegistryProvider>
        <ChatMessage message={{ ...base, components: [payload] }} />
      </RegistryProvider>,
    );
    expect(screen.getByText("Cost Estimation Breakdown")).toBeInTheDocument();
    expect(screen.queryByText("Rendered once the component registry")).toBeNull();
  });

  it("falls back safely for unknown component types under a registry provider", () => {
    const payload: ComponentPayload = {
      type: "hologram_projector" as ComponentType,
      version: "9.9",
      requestId: "req-2",
      data: {},
    };
    render(
      <RegistryProvider>
        <ChatMessage message={{ ...base, components: [payload] }} />
      </RegistryProvider>,
    );
    expect(screen.getByText("Unsupported component")).toBeInTheDocument();
    expect(screen.getByText("hologram_projector")).toBeInTheDocument();
  });

  it("applies high-contrast text colors to user and assistant bubbles", () => {
    const { container: userContainer } = renderMessage({
      ...base,
      id: "u9",
      role: "user",
      content: "Readable user text",
      status: "sent",
      createdAt: new Date().toISOString(),
    });
    const userBubble = userContainer.querySelector(".bg-blue-50");
    expect(userBubble?.className).toContain("text-blue-950");

    const { container: assistantContainer } = renderMessage(base);
    const assistantBubble = assistantContainer.querySelector(".bg-white");
    expect(assistantBubble?.className).toContain("text-gray-900");
    expect(assistantBubble?.className).not.toContain("text-white");
  });
});
