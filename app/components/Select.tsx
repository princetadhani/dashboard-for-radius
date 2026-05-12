"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export type SelectOption<T extends string = string> = {
  value: T;
  label: string;
};

type Props<T extends string> = {
  value: T;
  onChange: (next: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Width of the popover panel; defaults to trigger width. */
  menuClassName?: string;
};

export function Select<T extends string>({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className = "",
  menuClassName = "",
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState<number>(() => {
    const i = options.findIndex((o) => o.value === value);
    return i >= 0 ? i : 0;
  });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      const t = e.target as Node;
      if (
        triggerRef.current?.contains(t) ||
        menuRef.current?.contains(t)
      ) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  useEffect(() => {
    if (open) {
      const i = options.findIndex((o) => o.value === value);
      setHighlight(i >= 0 ? i : 0);
    }
  }, [open, options, value]);

  function onKey(e: React.KeyboardEvent) {
    if (disabled) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
      } else {
        const o = options[highlight];
        if (o) {
          onChange(o.value);
          setOpen(false);
        }
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setHighlight((h) => Math.min(h + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={onKey}
        className="input w-full flex items-center justify-between gap-2 cursor-pointer text-left disabled:cursor-not-allowed"
      >
        <span
          className={`truncate min-w-0 ${selected ? "" : "text-text-dim"}`}
          title={selected?.label}
        >
          {selected ? selected.label : (placeholder ?? "Select...")}
        </span>
        <ChevronDown
          size={14}
          className={`text-text-dim transition-transform shrink-0 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          ref={menuRef}
          id={listboxId}
          role="listbox"
          className={`popover absolute left-0 right-0 top-full mt-1 z-50 rounded-md py-1 max-h-72 overflow-y-auto ${menuClassName}`}
        >
          {options.map((o, i) => {
            const isSel = o.value === value;
            const isHi = i === highlight;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={isSel}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`w-full px-3 py-1.5 text-left text-sm flex items-center justify-between gap-2 min-w-0 ${
                  isHi ? "bg-white/10 text-text" : "text-text"
                } ${isSel ? "text-neon-blue" : ""}`}
                title={o.label}
              >
                <span className="truncate min-w-0">{o.label}</span>
                {isSel && <Check size={14} className="text-neon-blue shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
