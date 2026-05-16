import type { ReactNode } from "react";

type Props = {
  label: string;
  value: ReactNode;
  mono?: boolean;
};

/**
 * Specimen-style row: label ···· value
 * Uses a dotted leader line between label and value, as in flight manuals.
 */
export function DataRow({ label, value, mono = true }: Props) {
  return (
    <div className="flex items-baseline gap-3 py-2">
      <span className="eyebrow shrink-0">{label}</span>
      <span
        aria-hidden
        className="grow translate-y-[-3px] border-b border-dotted border-[color:var(--rule)]"
      />
      <span
        className={`${mono ? "font-mono" : ""} text-[13px] text-[color:var(--ink)] tabular-nums`}
      >
        {value}
      </span>
    </div>
  );
}
