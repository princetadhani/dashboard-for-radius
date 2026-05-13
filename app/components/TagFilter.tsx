"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Tag, X } from "lucide-react";

type Props = {
  allTags: string[];
  activeTags: Set<string>;
  onToggle: (tag: string) => void;
  onClear: () => void;
};

export function TagFilter({ allTags, activeTags, onToggle, onClear }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const count = activeTags.size;
  const filtered = query
    ? allTags.filter((t) => t.toLowerCase().includes(query.toLowerCase()))
    : allTags;

  const hasNoTags = allTags.length === 0;

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (hasNoTags) return;
          setOpen((v) => !v);
        }}
        className={`input flex items-center gap-2 ${hasNoTags ? "cursor-not-allowed opacity-50" : "cursor-pointer"
          }`}
      >
        <Tag size={14} className="text-text-dim" />
        <span className="text-sm">
          Tags{count > 0 && <span className="text-neon-blue ml-1">({count})</span>}
        </span>
        <ChevronDown
          size={14}
          className={`text-text-dim transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          ref={menuRef}
          className="popover absolute right-0 top-full mt-1 z-50 w-64 rounded-md py-1 max-h-80 overflow-hidden flex flex-col"
        >
          <div className="px-2 pt-2 pb-1.5 sticky top-0 bg-card">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tags..."
              className="input w-full !py-1.5 !text-xs"
            />
          </div>

          <div className="overflow-y-auto flex-1 show-scrollbar">
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-xs text-text-dim text-center">
                No tags match
              </div>
            ) : (
              filtered.map((t) => {
                const active = activeTags.has(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => onToggle(t)}
                    className="w-full px-3 py-1.5 text-left text-sm flex items-center justify-between gap-2 hover:bg-white/5"
                  >
                    <span className={active ? "text-neon-blue" : "text-text"}>{t}</span>
                    {active && <Check size={14} className="text-neon-blue shrink-0" />}
                  </button>
                );
              })
            )}
          </div>

          {count > 0 && (
            <div className="border-t border-border px-2 py-1.5 sticky bottom-0 bg-card">
              <button
                type="button"
                onClick={onClear}
                className="w-full text-xs text-text-dim hover:text-text flex items-center justify-center gap-1 py-1 rounded hover:bg-white/5"
              >
                <X size={12} /> Clear {count} tag{count > 1 ? "s" : ""}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
