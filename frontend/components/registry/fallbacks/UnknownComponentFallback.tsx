import { SectionCard } from "@/components/ui/provisr-app";

export function UnknownComponentFallback({ type }: { type: string }) {
  return (
    <SectionCard eyebrow="Unsupported component" className="border-amber-200 bg-amber-50">
      <p className="text-sm text-amber-800">
        No renderer is registered for component type{" "}
        <code className="rounded bg-amber-100 px-1 py-0.5 text-xs">{type}</code>.
      </p>
    </SectionCard>
  );
}
