"use client";

import { useState } from "react";
import { ExternalLink, Pencil, Trash2, Server, Activity } from "lucide-react";
import type { Host, HostStatusUpdate } from "../lib/types";
import { StatusDot } from "./StatusDot";

type Props = {
  hosts: Host[];
  statuses: Map<string, HostStatusUpdate>;
  onEdit: (h: Host) => void;
  onDelete: (h: Host) => void;
};

function formatMem(bytes?: number): string {
  if (!bytes) return "—";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function formatTs(ts?: number): string {
  if (!ts) return "never";
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export function HostsTable({ hosts, statuses, onEdit, onDelete }: Props) {
  const [confirmId, setConfirmId] = useState<string | null>(null);

  if (hosts.length === 0) {
    return (
      <div className="glass rounded-xl p-12 text-center">
        <Server className="mx-auto mb-3 text-text-dim" size={40} />
        <p className="text-text-dim">
          No hosts yet. Click <span className="text-neon-blue">+ New Host</span> to provision your first FreeRADIUS server.
        </p>
      </div>
    );
  }

  return (
    <div className="glass rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-text-dim text-left text-xs uppercase tracking-wider">
            <th className="px-4 py-3 font-medium">Friendly Name</th>
            <th className="px-4 py-3 font-medium">Endpoint</th>
            <th className="px-4 py-3 font-medium text-center">Host</th>
            <th className="px-4 py-3 font-medium text-center">Service</th>
            <th className="px-4 py-3 font-medium">Details</th>
            <th className="px-4 py-3 font-medium">Last Seen</th>
            <th className="px-4 py-3 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {hosts.map((h) => {
            const s = statuses.get(h.id);
            const hostState = s?.reachable ? "up" : s ? "down" : "unknown";
            const svcState = s?.service.healthy ? "up" : s ? "down" : "unknown";
            const launchUrl = `http://${h.ipAddress}:${h.port}`;
            return (
              <tr
                key={h.id}
                className="border-b border-border/60 hover:bg-white/5 transition-colors"
              >
                <td className="px-4 py-3">
                  <div className="font-medium">{h.friendlyName}</div>
                </td>
                <td className="px-4 py-3 font-mono text-text-dim">
                  {h.ipAddress}:{h.port}
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
                <td className="px-4 py-3 font-mono text-xs text-text-dim">
                  {s?.service.healthy ? (
                    <span>
                      pid {s.service.pid} · {formatMem(s.service.memory)}
                    </span>
                  ) : (
                    <span>—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-text-dim text-xs">{formatTs(s?.ts)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
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
                    {confirmId === h.id ? (
                      <div className="flex items-center gap-1 text-xs">
                        <button
                          onClick={() => {
                            onDelete(h);
                            setConfirmId(null);
                          }}
                          className="px-2 py-1 rounded bg-neon-red/20 text-neon-red hover:bg-neon-red/30"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setConfirmId(null)}
                          className="px-2 py-1 rounded text-text-dim hover:bg-white/10"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmId(h.id)}
                        className="p-2 rounded-md hover:bg-white/10 text-text-dim hover:text-neon-red transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="px-4 py-2 border-t border-border bg-black/20 text-xs text-text-dim flex items-center gap-2">
        <Activity size={12} />
        Live status updates every 10s via WebSocket
      </div>
    </div>
  );
}
