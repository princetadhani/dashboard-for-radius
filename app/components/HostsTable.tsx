"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  Check,
  X,
} from "lucide-react";
import type { Host, SshActionType } from "../lib/types";
import { useHostStatus } from "../lib/use-host-status";
import { StatusDot } from "./StatusDot";
import { TagList } from "./TagChips";
import { IpAddressDisplay } from "./IpAddressDisplay";

export type SortKey = "name" | "ip";
export type SortState = { key: SortKey; dir: "asc" | "desc" } | null;

type ColKey = "name" | "endpoint" | "tags" | "host" | "service" | "lastSync" | "actions";

const DEFAULT_WIDTHS: Record<ColKey, number> = {
  name: 150,
  endpoint: 160,
  tags: 200,
  host: 70,
  service: 140,
  lastSync: 160,
  actions: 185,
};

const MIN_WIDTHS: Record<ColKey, number> = {
  name: 120,
  endpoint: 120,
  tags: 80,
  host: 60,
  service: 140,
  lastSync: 130,
  actions: 185,
};

// Columns that cannot be resized
const FIXED_COLS: ColKey[] = ["host", "service", "actions"];

// Columns that auto-stretch to absorb remaining horizontal space (until user resizes them)
const FLEX_COLS: ColKey[] = ["name", "endpoint"];

type Props = {
  hosts: Host[];
  sort: SortState;
  onSortChange: (s: SortState) => void;
  onEdit: (h: Host) => void;
  onDelete: (h: Host) => void;
  onAction: (h: Host, action: SshActionType) => void;
  onCopyConfig: (source: Host) => void;
  onRefresh: (h: Host) => Promise<void>;
  latestVersion?: string | null;
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

const EndpointCell = memo(function EndpointCell({ host }: { host: Host }) {
  const s = useHostStatus(host.id);
  return (
    <IpAddressDisplay
      primaryIp={host.ipAddress}
      knownIps={host.knownIps}
      resolvedIps={s?.resolvedIps}
    />
  );
});

const RowStatus = memo(function RowStatus({ hostId }: { hostId: string }) {
  const s = useHostStatus(hostId);
  const hostState = s?.reachable ? "up" : s ? "down" : "unknown";
  const svcState = s?.service.healthy ? "up" : s ? "down" : "unknown";
  return (
    <>
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
        className="pl-8 pr-4 py-3 text-text-dim text-xs whitespace-nowrap overflow-hidden"
        title={s?.service.healthy ? `pid ${s.service.pid} · ${formatMem(s.service.memory)}` : undefined}
      >
        {formatTs(s?.ts)}
      </td>
    </>
  );
});

export function HostsTable({
  hosts,
  sort,
  onSortChange,
  onEdit,
  onDelete,
  onAction,
  onCopyConfig,
  onRefresh,
  latestVersion,
}: Props) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [refreshedId, setRefreshedId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number; placement: "down" | "up" } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const [colWidths, setColWidths] = useState<Record<ColKey, number>>(DEFAULT_WIDTHS);
  const [resizedCols, setResizedCols] = useState<Set<ColKey>>(new Set());
  const dragRef = useRef<{ col: ColKey; startX: number; startWidth: number; thEl: HTMLElement | null } | null>(null);

  const startResize = useCallback((col: ColKey, e: React.MouseEvent) => {
    e.preventDefault();
    const thEl = (e.currentTarget as HTMLElement).closest("th") as HTMLElement | null;
    const startWidth = thEl?.getBoundingClientRect().width ?? colWidths[col];
    dragRef.current = { col, startX: e.clientX, startWidth, thEl };
    setResizedCols((prev) => {
      if (prev.has(col)) return prev;
      const next = new Set(prev);
      next.add(col);
      return next;
    });
    setColWidths((prev) => ({ ...prev, [col]: startWidth }));
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
      const target = e.target as Node;
      const trigger = menuOpenId ? menuTriggerRefs.current.get(menuOpenId) : null;
      if (menuRef.current && !menuRef.current.contains(target) && (!trigger || !trigger.contains(target))) {
        setMenuOpenId(null);
        setMenuPos(null);
      }
    }
    function handleScrollOrResize() {
      setMenuOpenId(null);
      setMenuPos(null);
    }
    if (menuOpenId) {
      document.addEventListener("mousedown", handleClick);
      window.addEventListener("scroll", handleScrollOrResize, true);
      window.addEventListener("resize", handleScrollOrResize);
    }
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [menuOpenId]);

  const openMenu = useCallback((id: string) => {
    if (menuOpenId === id) {
      setMenuOpenId(null);
      setMenuPos(null);
      return;
    }
    const trigger = menuTriggerRefs.current.get(id);
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuHeight = 140;
    const spaceBelow = window.innerHeight - rect.bottom;
    const placement: "down" | "up" = spaceBelow < menuHeight + 16 ? "up" : "down";
    setMenuPos({
      top: placement === "down" ? rect.bottom + 4 : rect.top - 4,
      right: window.innerWidth - rect.right,
      placement,
    });
    setMenuOpenId(id);
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

  const totalWidth = Object.values(w).reduce((a, b) => a + b, 0);

  const colStyle = (col: ColKey): React.CSSProperties =>
    FLEX_COLS.includes(col) && !resizedCols.has(col) ? {} : { width: w[col] };

  return (
    <div className="glass rounded-xl overflow-x-auto">
      <table className="text-sm table-fixed w-full" style={{ minWidth: totalWidth }}>
        <colgroup>
          <col style={colStyle("name")} />
          <col style={colStyle("endpoint")} />
          <col style={colStyle("tags")} />
          <col style={colStyle("host")} />
          <col style={colStyle("service")} />
          <col style={colStyle("lastSync")} />
          <col style={colStyle("actions")} />
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
            <th className="px-4 py-3 font-medium text-center relative whitespace-nowrap">Radius Service</th>
            <th className="pl-8 pr-4 py-3 font-medium relative">
              Last Sync
              <ResizeHandle col="lastSync" />
            </th>
            <th className="px-4 py-3 font-medium text-left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {hosts.map((h) => {
            const launchUrl = `http://${h.ipAddress}:${h.port}`;
            const isConfirming = confirmId === h.id;
            const hasUpdate = !!(h.installedVersion && latestVersion && h.installedVersion !== latestVersion);
            return (
              <tr
                key={h.id}
                className="border-b border-border/60 hover:bg-white/5 transition-colors"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium truncate" title={h.friendlyName}>
                      {h.friendlyName}
                    </span>
                    {hasUpdate && (
                      <span className="relative inline-flex items-center group/upd shrink-0">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-neon-blue/15 border border-neon-blue/30 text-neon-blue font-medium leading-none cursor-default">
                          ↑ {latestVersion}
                        </span>
                        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1.5 text-[11px] text-white whitespace-nowrap rounded-xl border border-white/25 backdrop-blur-md bg-white/10 shadow-[0_8px_20px_rgba(0,0,0,0.4),inset_0_0_10px_rgba(255,255,255,0.08)] opacity-0 invisible group-hover/upd:opacity-100 group-hover/upd:visible transition-all duration-150 pointer-events-none z-[9999]">
                          New version available — upgrade your FreeRADIUS UI portal
                          <span className="absolute top-full left-1/2 -translate-x-1/2 border-[5px] border-transparent border-t-white/25" />
                        </span>
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-text-dim">
                  <EndpointCell host={h} />
                </td>
                <td className="px-4 py-3 overflow-hidden">
                  <TagList tags={h.tags} />
                </td>
                <RowStatus hostId={h.id} />
                <td className="px-2 py-3">
                  {isConfirming ? (
                    <div className="flex items-center justify-center gap-1">
                      <span className="text-xs text-text-dim mr-1">Delete?</span>
                      <button
                        onClick={() => { onDelete(h); setConfirmId(null); }}
                        className="p-2 rounded-md bg-neon-red/20 border border-neon-red/40 text-neon-red hover:bg-neon-red/30 transition-colors"
                        title="Confirm delete"
                      >
                        <Check size={16} />
                      </button>
                      <button
                        onClick={() => setConfirmId(null)}
                        className="p-2 rounded-md hover:bg-white/10 text-text-dim hover:text-text transition-colors"
                        title="Cancel"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-start gap-1">
                      <a
                        href={launchUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 rounded-md hover:bg-white/10 text-neon-blue transition-colors"
                        title={`Open ${launchUrl}`}
                      >
                        <ExternalLink size={16} />
                      </a>
                      <span className="relative inline-flex items-center group/refresh">
                        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 text-[11px] text-white whitespace-nowrap rounded-xl border border-white/25 backdrop-blur-md bg-white/10 shadow-[0_8px_20px_rgba(0,0,0,0.4),inset_0_0_10px_rgba(255,255,255,0.08)] opacity-0 invisible group-hover/refresh:opacity-100 group-hover/refresh:visible transition-all duration-150 pointer-events-none z-[9999]">
                          Refresh host data & status
                          <span className="absolute top-full left-1/2 -translate-x-1/2 border-[5px] border-transparent border-t-white/25" />
                        </span>
                        <button
                          onClick={async () => {
                            setRefreshingId(h.id);
                            await onRefresh(h);
                            setRefreshingId(null);
                            setRefreshedId(h.id);
                            setTimeout(() => setRefreshedId(null), 500);
                          }}
                          disabled={refreshingId === h.id}
                          className={`p-2 rounded-md hover:bg-white/10 transition-colors disabled:opacity-40 ${refreshedId === h.id ? "text-neon-green" : "text-text-dim hover:text-text"}`}
                        >
                          {refreshedId === h.id
                            ? <Check size={16} />
                            : <RotateCcw size={16} className={refreshingId === h.id ? "animate-spin" : ""} />
                          }
                        </button>
                      </span>
                      <button
                        onClick={() => onEdit(h)}
                        className="p-2 rounded-md hover:bg-white/10 text-text-dim hover:text-text transition-colors"
                        title="Edit"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        ref={(el) => {
                          if (el) menuTriggerRefs.current.set(h.id, el);
                          else menuTriggerRefs.current.delete(h.id);
                        }}
                        onClick={() => openMenu(h.id)}
                        className="p-2 rounded-md hover:bg-white/10 text-text-dim hover:text-text transition-colors"
                        title="More actions"
                      >
                        <MoreVertical size={16} />
                      </button>
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
      {menuOpenId && menuPos && typeof document !== "undefined" && createPortal(
        (() => {
          const host = hosts.find((h) => h.id === menuOpenId);
          if (!host) return null;
          const menuHasUpdate = !!(host.installedVersion && latestVersion && host.installedVersion !== latestVersion);
          const style: React.CSSProperties = {
            position: "fixed",
            right: menuPos.right,
            ...(menuPos.placement === "down"
              ? { top: menuPos.top }
              : { bottom: window.innerHeight - menuPos.top }),
            zIndex: 50,
          };
          return (
            <div ref={menuRef} style={style} className="w-56 popover rounded-md py-1">
              <MenuItem
                icon={<RotateCcw size={14} />}
                label="Restart FreeRADIUS"
                onClick={() => { onAction(host, "restart-service"); setMenuOpenId(null); setMenuPos(null); }}
              />
              <MenuItem
                icon={<RefreshCw size={14} />}
                label={menuHasUpdate ? `Update to ${latestVersion}` : "Reinstall / Repair"}
                onClick={() => { onAction(host, "reinstall"); setMenuOpenId(null); setMenuPos(null); }}
              />
              <div className="border-t border-border my-1" />
              <MenuItem
                icon={<Copy size={14} />}
                label="Copy config to another host..."
                onClick={() => { onCopyConfig(host); setMenuOpenId(null); setMenuPos(null); }}
              />
            </div>
          );
        })(),
        document.body
      )}
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
