import type { CSSProperties } from "react";

type RuleProps = {
  className?: string;
  animate?: boolean;
  style?: CSSProperties;
};

export function Rule({ className = "", animate = false, style }: RuleProps) {
  return (
    <span
      aria-hidden
      className={`rule ${animate ? "rule-draw" : ""} ${className}`.trim()}
      style={style}
    />
  );
}
