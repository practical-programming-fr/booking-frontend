type Props = {
  index: string;
  label: string;
  className?: string;
};

/**
 * 01 / HORIZONS — Rams/Vignelli eyebrow.
 */
export function SectionLabel({ index, label, className = "" }: Props) {
  return (
    <div className={`eyebrow flex items-center gap-2 ${className}`.trim()}>
      <span>{index}</span>
      <span aria-hidden>/</span>
      <span>{label}</span>
    </div>
  );
}
