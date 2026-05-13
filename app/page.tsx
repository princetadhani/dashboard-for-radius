"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Radio } from "lucide-react";
import { toast } from "sonner";
import type { Host, HostStatusUpdate, SshActionType } from "./lib/types";
import { fetchHosts, deleteHost } from "./lib/api";
import { getSocket } from "./lib/socket";
import { HostsTable, type SortState } from "./components/HostsTable";
import { SidePanel } from "./components/SidePanel";
import { Toolbar, type StatusFilter } from "./components/Toolbar";
import { SshActionModal } from "./components/SshActionModal";
import { CopyConfigModal } from "./components/CopyConfigModal";

export default function DashboardPage() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [statusMap, setStatusMap] = useState<Map<string, HostStatusUpdate>>(new Map());
  const [, setTick] = useState(0);

  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<"create" | "edit">("create");
  const [editing, setEditing] = useState<Host | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortState>(null);

  const [actionOpen, setActionOpen] = useState(false);
  const [actionType, setActionType] = useState<SshActionType | null>(null);
  const [actionHost, setActionHost] = useState<Host | null>(null);

  const [copySource, setCopySource] = useState<Host | null>(null);

  const reload = useCallback(async () => {
    const { hosts, statuses } = await fetchHosts();
    setHosts(hosts);
    const m = new Map<string, HostStatusUpdate>();
    for (const s of statuses) m.set(s.hostId, s);
    setStatusMap(m);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const socket = getSocket();

    const onStatus = (u: HostStatusUpdate) => {
      setStatusMap((prev) => {
        const next = new Map(prev);
        next.set(u.hostId, u);
        return next;
      });
    };
    const onCreated = (h: Host) => {
      setHosts((prev) => (prev.some((p) => p.id === h.id) ? prev : [h, ...prev]));
      toast.success(`Provisioned ${h.friendlyName}`);
    };
    const onUpdated = (h: Host) => {
      setHosts((prev) => prev.map((p) => (p.id === h.id ? h : p)));
    };
    const onDeleted = ({ id }: { id: string }) => {
      setHosts((prev) => prev.filter((p) => p.id !== id));
      setStatusMap((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    };

    socket.on("status:update", onStatus);
    socket.on("host:created", onCreated);
    socket.on("host:updated", onUpdated);
    socket.on("host:deleted", onDeleted);

    return () => {
      socket.off("status:update", onStatus);
      socket.off("host:created", onCreated);
      socket.off("host:updated", onUpdated);
      socket.off("host:deleted", onDeleted);
    };
  }, []);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const h of hosts) for (const t of h.tags) set.add(t);
    return Array.from(set).sort();
  }, [hosts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = hosts.filter((h) => {
      if (q && !h.friendlyName.toLowerCase().includes(q) && !h.ipAddress.includes(q)) {
        return false;
      }
      if (activeTags.size > 0 && !h.tags.some((t) => activeTags.has(t))) {
        return false;
      }
      if (statusFilter !== "all") {
        const s = statusMap.get(h.id);
        if (statusFilter === "healthy" && !s?.service.healthy) return false;
        if (statusFilter === "unhealthy" && (!s?.reachable || s.service.healthy)) return false;
        if (statusFilter === "unreachable" && s?.reachable !== false) return false;
      }
      return true;
    });

    if (sort) {
      const dirMul = sort.dir === "asc" ? 1 : -1;
      out = [...out].sort((a, b) => {
        const cmp =
          sort.key === "name"
            ? a.friendlyName.localeCompare(b.friendlyName)
            : a.ipAddress.localeCompare(b.ipAddress, undefined, { numeric: true });
        return cmp * dirMul;
      });
    } else {
      out = [...out].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    return out;
  }, [hosts, search, statusFilter, activeTags, sort, statusMap]);

  const summary = useMemo(() => {
    let online = 0;
    let healthy = 0;
    for (const h of hosts) {
      const s = statusMap.get(h.id);
      if (s?.reachable) online++;
      if (s?.service.healthy) healthy++;
    }
    return { total: hosts.length, online, healthy };
  }, [hosts, statusMap]);

  function openSingleAction(host: Host, action: SshActionType) {
    setActionType(action);
    setActionHost(host);
    setActionOpen(true);
  }

  return (
    <main className="flex-1 flex flex-col px-6 lg:px-10 py-6 w-full">
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg glass flex items-center justify-center">
            <Radio className="text-neon-blue" size={22} />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">RADIUSCTRL</h1>
            <p className="text-xs text-text-dim">FreeRADIUS Fleet Dashboard</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Stat label="Hosts" value={summary.total} />
          <Stat label="Online" value={summary.online} accent="green" />
          <Stat label="Healthy" value={summary.healthy} accent="green" />
          <button
            onClick={() => {
              setPanelMode("create");
              setEditing(null);
              setPanelOpen(true);
            }}
            className="px-4 py-2 rounded-md bg-neon-blue/20 border border-neon-blue/50 text-neon-blue hover:bg-neon-blue/30 flex items-center gap-2 text-sm font-medium"
          >
            <Plus size={16} />
            New Host
          </button>
        </div>
      </header>

      <Toolbar
        search={search}
        onSearchChange={setSearch}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        allTags={allTags}
        activeTags={activeTags}
        onToggleTag={(t) => {
          setActiveTags((prev) => {
            const next = new Set(prev);
            if (next.has(t)) next.delete(t);
            else next.add(t);
            return next;
          });
        }}
        onClearFilters={() => {
          setSearch("");
          setStatusFilter("all");
          setActiveTags(new Set());
        }}
        totalShown={filtered.length}
        totalAll={hosts.length}
      />

      <HostsTable
        hosts={filtered}
        statuses={statusMap}
        sort={sort}
        onSortChange={setSort}
        onEdit={(h) => {
          setPanelMode("edit");
          setEditing(h);
          setPanelOpen(true);
        }}
        onDelete={async (h) => {
          try {
            await deleteHost(h.id);
            setHosts((prev) => prev.filter((p) => p.id !== h.id));
            toast.success(`Deleted ${h.friendlyName}`);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
          }
        }}
        onAction={openSingleAction}
        onCopyConfig={(h) => setCopySource(h)}
      />

      <SidePanel
        open={panelOpen}
        mode={panelMode}
        editing={editing}
        onClose={() => setPanelOpen(false)}
        onSuccess={reload}
      />

      <SshActionModal
        open={actionOpen}
        action={actionType}
        host={actionHost}
        onClose={() => setActionOpen(false)}
      />

      <CopyConfigModal
        source={copySource}
        hosts={hosts}
        onClose={() => setCopySource(null)}
      />
    </main>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "green";
}) {
  return (
    <div className="glass rounded-md px-3 py-1.5 text-center min-w-[68px]">
      <div
        className={`text-base font-mono font-semibold ${
          accent === "green" ? "text-neon-green" : "text-text"
        }`}
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-text-dim">{label}</div>
    </div>
  );
}
