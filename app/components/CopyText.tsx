"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

type Props = {
  /** The display text. */
  children: React.ReactNode;
  /** The actual value to copy (defaults to children if string). */
  value: string;
  /** Tooltip prefix, e.g. "Copy IP" → tooltip becomes "Copy IP". */
  label?: string;
  /** Extra classes for the inline wrapper. */
  className?: string;
  /** Extra classes for the displayed text span. */
  textClassName?: string;
};

/**
 * Shows text that can be copied by clicking either the text itself or the
 * fade-in copy icon next to it. Whole element is a button to maximize hit area.
 */
export function CopyText({
  children,
  value,
  label,
  className = "",
  textClassName = "",
}: Props) {
  const [copied, setCopied] = useState(false);

  async function copy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? "Copied!" : (label ?? `Copy ${value}`)}
      aria-label={label ?? `Copy ${value}`}
      className={`group inline-flex items-center gap-1 cursor-pointer hover:text-text rounded px-1 -mx-1 hover:bg-white/5 transition-colors min-w-0 ${className}`}
    >
      <span className={`min-w-0 truncate ${textClassName}`}>{children}</span>
      {copied ? (
        <Check size={12} className="text-neon-green shrink-0" />
      ) : (
        <Copy
          size={12}
          className="text-text-dim opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
        />
      )}
    </button>
  );
}
