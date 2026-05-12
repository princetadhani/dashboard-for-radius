"use client";

import { useState, type KeyboardEvent } from "react";
import { TagChip } from "./TagChips";

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
};

const TAG_RE = /^[a-zA-Z0-9_\-:.]+$/;

export function TagInput({ value, onChange, disabled, placeholder }: Props) {
  const [draft, setDraft] = useState("");

  function addTag(raw: string) {
    const t = raw.trim();
    if (!t || !TAG_RE.test(t) || t.length > 32) return;
    if (value.includes(t)) return;
    if (value.length >= 20) return;
    onChange([...value, t]);
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(draft);
      setDraft("");
    } else if (e.key === "Backspace" && draft.length === 0 && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="input w-full flex flex-wrap items-center gap-1.5 min-h-[38px] py-1.5">
      {value.map((t) => (
        <TagChip
          key={t}
          tag={t}
          onRemove={disabled ? undefined : () => onChange(value.filter((x) => x !== t))}
        />
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKey}
        onBlur={() => {
          if (draft.trim()) {
            addTag(draft);
            setDraft("");
          }
        }}
        disabled={disabled}
        placeholder={value.length === 0 ? (placeholder ?? "prod, lab, customer-x...") : ""}
        className="bg-transparent flex-1 min-w-[100px] outline-none text-sm"
      />
    </div>
  );
}
