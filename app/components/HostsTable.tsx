"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ExternalLink,
  Pencil,
  Trash2,
  Server,
  MoreVertical,
  RefreshCw,
  RotateCcw,
  Copy,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
} from "lucide-react";
import type { Host, HostStatusUpdate, SshActionType } from "../lib/types";
import { StatusDot } from "./StatusDot";
import { TagList } from "./TagChips";
import { CopyText } from "./CopyText";

export type SortKey = "name" | "ip";
export type SortState = { key: SortKey; dir: "asc" | "desc" } | null;

type ColKey = "name" | "endpoint" | "tags" | "host" | "service" | "lastSync" | "actions";

const DEFAULT_WIDTHS: Record<ColKey, number> = {
  name: 240,
  endpoint: 200,
  tags: 200,
  host: 70,
  service: 70,
  lastSync: 150,
  actions: 180,
};

const MIN_WIDTHS: Record<ColKey, number> = {
  name: 120,
  endpoint: 120,
  tags: 80,
  host: 60,
  service: 60,
  lastSync: 120,
  actions: 160,
};

// Columns that cannot be resized
const FIXED_COLS: ColKey[] = ["host", "service", "actions"];

type Props = {
  hosts: Host[];
  statuses: Map<string, HostStatusUpdate>;
  sort: SortState;
  onSortChange: (s: SortState) => void;
  onEdit: (h: Host) => void;
  onDelete: (h: Host) => void;
  onAction: (h: Host, action: SshActionType) => void;
  onCopyConfig: (source: Host) => void;
};

function formatMem(bytes?: number): string {
  if (!bytes) return "—";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function formatTs(ts?: number): string {
  if (!ts) return "never";
  const d = new Date(ts);
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return `${date} ${time}`;
}

export function HostsTable({
  hosts,
  statuses,
  sort,
  onSortChange,
  onEdit,
  onDelete,
  onAction,
  onCopyConfig,
}: Props) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [colWidths, setColWidths] = useState<Record<ColKey, number>>(DEFAULT_WIDTHS);
  const dragRef = useRef<{ col: ColKey; startX: number; startWidth: number } | null>(null);

  const startResize = useCallback((col: ColKey, e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { col, startX: e.clientX, startWidth: colWidths[col] };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [colWidths]);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragRef.current) return;
      const { col, startX, startWidth } = dragRef.current;
      const delta = e.clientX - startX;
      const next = Math.max(MIN_WIDTHS[col], startWidth + delta);
      setColWidths((prev) => ({ ...prev, [col]: next }));
    }
    function onMouseUp() {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    }
    if (menuOpenId) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpenId]);

  function handleSortClick(key: SortKey) {
    if (sort && sort.key === key) {
      onSortChange({ key, dir: sort.dir === "asc" ? "desc" : "asc" });
    } else {
      onSortChange({ key, dir: "asc" });
    }
  }

  if (hosts.length === 0) {
    return (
      <div className="glass rounded-xl p-12 text-center">
        <Server className="mx-auto mb-3 text-text-dim" size={40} />
        <p className="text-text-dim">
          No hosts match your filters. Click{" "}
          <span className="text-neon-blue">+ New Host</span> to provision your first FreeRADIUS server, or clear filters.
        </p>
      </div>
    );
  }

  function ResizeHandle({ col }: { col: ColKey }) {
    if (FIXED_COLS.includes(col)) return null;
    return (
      <div
        onMouseDown={(e) => startResize(col, e)}
        className="absolute right-0 top-0 bottom-0 w-4 flex items-center justify-center cursor-col-resize group/handle z-10"
      >
        <div className="w-px h-4 bg-border group-hover/handle:bg-neon-blue/60 group-hover/handle:h-full transition-all" />
      </div>
    );
  }

  const w = colWidths;

  return (
    <div className="glass rounded-xl overflow-x-auto">
      <table className="text-sm table-fixed" style={{ width: Object.values(w).reduce((a, b) => a + b, 0) }}>
        <colgroup>
          <col style={{ width: w.name }} />
          <col style={{ width: w.endpoint }} />
          <col style={{ width: w.tags }} />
          <col style={{ width: w.host }} />
          <col style={{ width: w.service }} />
          <col style={{ width: w.lastSync }} />
          <col style={{ width: w.actions }} />
        </colgroup>
        <thead>
          <tr className="border-b border-border text-text-dim text-left text-xs uppercase tracking-wider">
            <SortableTh
              label="Friendly Name"
              sortKey="name"
              currentSort={sort}
              onClick={handleSortClick}
              resizeHandle={<ResizeHandle col="name" />}
            />
            <SortableTh
              label="Endpoint"
              sortKey="ip"
              currentSort={sort}
              onClick={handleSortClick}
              resizeHandle={<ResizeHandle col="endpoint" />}
            />
            <th className="px-4 py-3 font-medium relative">
              Tags
              <ResizeHandle col="tags" />
            </th>
            <th className="px-4 py-3 font-medium text-center relative">Host</th>
            <th className="px-4 py-3 font-medium text-center relative">Service</th>
            <th className="px-4 py-3 font-medium relative">
              Last Sync
              <ResizeHandle col="lastSync" />
            </th>
            <th className="px-4 py-3 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {hosts.map((h) => {
            const s = statuses.get(h.id);
            const hostState = s?.reachable ? "up" : s ? "down" : "unknown";
            const svcState = s?.service.healthy ? "up" : s ? "down" : "unknown";
            const launchUrl = `http://${h.ipAddress}:${h.port}`;
            const isConfirming = confirmId === h.id;
            return (
              <tr
                key={h.id}
                className="border-b border-border/60 hover:bg-white/5 transition-colors"
              >
                <td className="px-4 py-3">
                  <div className="font-medium truncate" title={h.friendlyName}>
                    {h.friendlyName}
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-text-dim">
                  <div className="flex min-w-0">
                    <CopyText value={h.ipAddress} label="Copy address" className="min-w-0">
                      {h.ipAddress}
                    </CopyText>
                  </div>
                </td>
                <td className="px-4 py-3 overflow-hidden">
                  <TagList tags={h.tags} />
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="inline-flex items-center justify-center">
                    <StatusDot
                      state={hostState}
                      title={
                        hostState === "up"
                          ? "Reachable"
                          : hostState === "down"
                            ? "Unreachable"
                            : "Pending first probe"
                      }
                    />
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="inline-flex items-center justify-center">
                    <StatusDot
                      state={svcState}
                      title={
                        svcState === "up"
                          ? `FreeRADIUS healthy (pid ${s?.service.pid ?? "?"})`
                          : svcState === "down"
                            ? "FreeRADIUS not healthy"
                            : "Pending"
                      }
                    />
                  </div>
                </td>
                <td
                  className="px-4 py-3 text-text-dim text-xs whitespace-nowrap overflow-hidden"
                  title={s?.service.healthy ? `pid ${s.service.pid} · ${formatMem(s.service.memory)}` : undefined}
                >
                  {formatTs(s?.ts)}
                </td>
                <td className="px-2 py-3">
                  {isConfirming ? (
                    <div className="flex items-center justify-end gap-1.5">
                      <span className="text-xs text-text-dim mr-1">Delete?</span>
                      <button
                        onClick={() => { onDelete(h); setConfirmId(null); }}
                        className="px-2.5 py-1 rounded text-xs bg-neon-red/20 border border-neon-red/40 text-neon-red hover:bg-neon-red/30"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setConfirmId(null)}
                        className="px-2.5 py-1 rounded text-xs text-text-dim hover:bg-white/10"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-end gap-1">
                      <a
                        href={launchUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 rounded-md hover:bg-white/10 text-neon-blue transition-colors"
                        title={`Open ${launchUrl}`}
                      >
                        <ExternalLink size={16} />
                      </a>
                      <button
                        onClick={() => onEdit(h)}
                        className="p-2 rounded-md hover:bg-white/10 text-text-dim hover:text-text transition-colors"
                        title="Edit"
                      >
                        <Pencil size={16} />
                      </button>
                      <div className="relative" ref={menuOpenId === h.id ? menuRef : null}>
                        <button
                          onClick={() => setMenuOpenId(menuOpenId === h.id ? null : h.id)}
                          className="p-2 rounded-md hover:bg-white/10 text-text-dim hover:text-text transition-colors"
                          title="More actions"
                        >
                          <MoreVertical size={16} />
                        </button>
                        {menuOpenId === h.id && (
                          <div className="absolute right-0 top-full mt-1 z-30 w-56 popover rounded-md py-1">
                            <MenuItem
                              icon={<RotateCcw size={14} />}
                              label="Restart FreeRADIUS"
                              onClick={() => { onAction(h, "restart-service"); setMenuOpenId(null); }}
                            />
                            <MenuItem
                              icon={<RefreshCw size={14} />}
                              label="Reinstall / Repair"
                              onClick={() => { onAction(h, "reinstall"); setMenuOpenId(null); }}
                            />
                            <div className="border-t border-border my-1" />
                            <MenuItem
                              icon={<Copy size={14} />}
                              label="Copy config to another host..."
                              onClick={() => { onCopyConfig(h); setMenuOpenId(null); }}
                            />
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => setConfirmId(h.id)}
                        className="p-2 rounded-md hover:bg-white/10 text-text-dim hover:text-neon-red transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SortableTh({
  label,
  sortKey,
  currentSort,
  onClick,
  resizeHandle,
}: {
  label: string;
  sortKey: SortKey;
  currentSort: SortState;
  onClick: (key: SortKey) => void;
  resizeHandle?: React.ReactNode;
}) {
  const active = currentSort?.key === sortKey;
  const dir = active ? currentSort!.dir : null;
  return (
    <th className="px-4 py-3 font-medium relative">
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className="flex items-center gap-1.5 hover:text-text transition-colors uppercase tracking-wider text-xs"
      >
        {label}
        {dir === "asc" ? (
          <ArrowUp size={12} className="text-neon-blue" />
        ) : dir === "desc" ? (
          <ArrowDown size={12} className="text-neon-blue" />
        ) : (
          <ChevronsUpDown size={12} className="opacity-40" />
        )}
      </button>
      {resizeHandle}
    </th>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full px-3 py-2 text-left text-sm text-text hover:bg-white/10 flex items-center gap-2"
    >
      <span className="text-text-dim">{icon}</span>
      {label}
    </button>
  );
}
