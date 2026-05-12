"use client";

import { X } from "lucide-react";

const PALETTE = [
  { bg: "rgba(51, 153, 255, 0.18)", fg: "#7ab8ff", border: "rgba(51, 153, 255, 0.4)" },
  { bg: "rgba(158, 206, 106, 0.18)", fg: "#bce18a", border: "rgba(158, 206, 106, 0.4)" },
  { bg: "rgba(239, 68, 68, 0.16)", fg: "#fca5a5", border: "rgba(239, 68, 68, 0.4)" },
  { bg: "rgba(251, 191, 36, 0.18)", fg: "#fcd34d", border: "rgba(251, 191, 36, 0.4)" },
  { bg: "rgba(167, 139, 250, 0.18)", fg: "#c4b5fd", border: "rgba(167, 139, 250, 0.4)" },
  { bg: "rgba(244, 114, 182, 0.18)", fg: "#f9a8d4", border: "rgba(244, 114, 182, 0.4)" },
];

function colorFor(tag: string) {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function TagChip({
  tag,
  onRemove,
  active,
  onClick,
}: {
  tag: string;
  onRemove?: () => void;
  active?: boolean;
  onClick?: () => void;
}) {
  const c = colorFor(tag);
  return (
    <span
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${
        onClick ? "cursor-pointer" : ""
      } ${active ? "ring-2 ring-offset-1 ring-offset-bg" : ""}`}
      style={{
        backgroundColor: c.bg,
        color: c.fg,
        borderColor: c.border,
      }}
    >
      {tag}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="hover:opacity-70"
        >
          <X size={10} />
        </button>
      )}
    </span>
  );
}

export function TagList({ tags, max = 3 }: { tags: string[]; max?: number }) {
  if (tags.length === 0) return <span className="text-text-dim text-xs">—</span>;
  const visible = tags.slice(0, max);
  const overflow = tags.length - visible.length;
  return (
    <div className="flex flex-nowrap items-center gap-1 overflow-hidden">
      {visible.map((t) => (
        <TagChip key={t} tag={t} />
      ))}
      {overflow > 0 && (
        <span
          title={tags.slice(max).join(", ")}
          className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border border-border text-text-dim shrink-0"
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
