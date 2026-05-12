"use client";

import { Search, X } from "lucide-react";
import { Select } from "./Select";
import { TagFilter } from "./TagFilter";

export type StatusFilter = "all" | "healthy" | "unhealthy" | "unreachable";

type Props = {
  search: string;
  onSearchChange: (v: string) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (v: StatusFilter) => void;
  allTags: string[];
  activeTags: Set<string>;
  onToggleTag: (tag: string) => void;
  onClearFilters: () => void;
  totalShown: number;
  totalAll: number;
};

export function Toolbar({
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  allTags,
  activeTags,
  onToggleTag,
  onClearFilters,
  totalShown,
  totalAll,
}: Props) {
  const filtersActive =
    search.length > 0 || statusFilter !== "all" || activeTags.size > 0;

  function clearTags() {
    for (const t of Array.from(activeTags)) onToggleTag(t);
  }

  return (
    <div className="glass rounded-xl p-3 mb-3">
      <div className="flex items-center gap-2 flex-nowrap">
        <div className="relative flex-1 min-w-0">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none"
          />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by name or IP..."
            className="input w-full pl-8"
          />
        </div>

        <Select<StatusFilter>
          value={statusFilter}
          onChange={onStatusFilterChange}
          className="w-40 shrink-0"
          options={[
            { value: "all", label: "All statuses" },
            { value: "healthy", label: "Healthy" },
            { value: "unhealthy", label: "Unhealthy" },
            { value: "unreachable", label: "Unreachable" },
          ]}
        />

        <TagFilter
          allTags={allTags}
          activeTags={activeTags}
          onToggle={onToggleTag}
          onClear={clearTags}
        />

        {filtersActive && (
          <button
            onClick={onClearFilters}
            className="text-xs text-text-dim hover:text-text flex items-center gap-1 px-2 py-1.5 rounded hover:bg-white/5 shrink-0"
          >
            <X size={12} /> Clear
          </button>
        )}

        <div className="text-xs text-text-dim font-mono shrink-0 pl-1 ml-auto">
          {totalShown === totalAll
            ? `${totalAll} hosts`
            : `${totalShown} / ${totalAll}`}
        </div>
      </div>
    </div>
  );
}
