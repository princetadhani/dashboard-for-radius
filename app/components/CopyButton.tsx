"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

type Props = {
  value: string;
  label?: string;
  className?: string;
};

/**
 * Small copy-to-clipboard icon button. Designed to live inside a `group`
 * container so it can fade in on hover.
 */
export function CopyButton({ value, label, className = "" }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore clipboard errors
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? "Copied!" : (label ?? `Copy ${value}`)}
      aria-label={label ?? `Copy ${value}`}
      className={`opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1 rounded hover:bg-white/10 text-text-dim hover:text-text ${className}`}
    >
      {copied ? (
        <Check size={12} className="text-neon-green" />
      ) : (
        <Copy size={12} />
      )}
    </button>
  );
}
