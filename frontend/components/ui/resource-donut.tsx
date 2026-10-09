type ResourceDonutProps = {
  label: string;
  color: string;
  value: number;
};

export function ResourceDonut({ label, color, value }: ResourceDonutProps) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative size-16">
        <svg className="size-16 -rotate-90" viewBox="0 0 36 36">
          <circle
            cx="18"
            cy="18"
            fill="none"
            r="15.9"
            stroke="var(--provisr-surface-2)"
            strokeWidth="3.2"
          />
          <circle
            cx="18"
            cy="18"
            fill="none"
            r="15.9"
            stroke={color}
            strokeWidth="3.2"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-gray-900">
          {value}
        </span>
      </div>
      <span className="text-xs text-gray-600">{label}</span>
    </div>
  );
}