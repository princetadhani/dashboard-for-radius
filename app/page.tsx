"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Radio, RefreshCw } from "lucide-react";
import type { Host, HostStatusUpdate } from "./lib/types";
import { fetchHosts, deleteHost } from "./lib/api";
import { getSocket } from "./lib/socket";
import { HostsTable } from "./components/HostsTable";
import { SidePanel } from "./components/SidePanel";

export default function DashboardPage() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [statusMap, setStatusMap] = useState<Map<string, HostStatusUpdate>>(new Map());
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<"create" | "edit">("create");
  const [editing, setEditing] = useState<Host | null>(null);
  const [, setTick] = useState(0);

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      const { hosts, statuses } = await fetchHosts();
      setHosts(hosts);
      const m = new Map<string, HostStatusUpdate>();
      for (const s of statuses) m.set(s.hostId, s);
      setStatusMap(m);
    } finally {
      setLoading(false);
    }
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

  return (
    <main className="flex-1 flex flex-col px-6 lg:px-10 py-6 max-w-7xl w-full mx-auto">
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
            onClick={() => void reload()}
            className="p-2 rounded-md glass hover:bg-white/10 text-text-dim hover:text-text"
            title="Refresh"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
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

      <HostsTable
        hosts={hosts}
        statuses={statusMap}
        onEdit={(h) => {
          setPanelMode("edit");
          setEditing(h);
          setPanelOpen(true);
        }}
        onDelete={async (h) => {
          await deleteHost(h.id);
          setHosts((prev) => prev.filter((p) => p.id !== h.id));
        }}
      />

      <SidePanel
        open={panelOpen}
        mode={panelMode}
        editing={editing}
        onClose={() => setPanelOpen(false)}
      />

      <footer className="mt-auto pt-8 text-xs text-text-dim text-center">
        Backend:{" "}
        <span className="font-mono">
          {process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000"}
        </span>
      </footer>
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
