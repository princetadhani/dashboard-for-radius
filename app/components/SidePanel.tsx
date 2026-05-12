"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, CheckCircle2, XCircle } from "lucide-react";
import type { Host, ProvisionDone, ProvisionLog } from "../lib/types";
import { createHost, updateHost } from "../lib/api";
import { getSocket } from "../lib/socket";

type Props = {
  open: boolean;
  mode: "create" | "edit";
  editing: Host | null;
  onClose: () => void;
};

type Phase = "idle" | "provisioning" | "success" | "error";

export function SidePanel({ open, mode, editing, onClose }: Props) {
  const [friendlyName, setFriendlyName] = useState("");
  const [ipAddress, setIpAddress] = useState("");
  const [port, setPort] = useState(9000);
  const [sshPort, setSshPort] = useState(22);
  const [sshUsername, setSshUsername] = useState("");
  const [sshPassword, setSshPassword] = useState("");

  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [logs, setLogs] = useState<ProvisionLog[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Reset / hydrate when panel opens or mode/editing changes
  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && editing) {
      setFriendlyName(editing.friendlyName);
      setIpAddress(editing.ipAddress);
      setPort(editing.port);
    } else {
      setFriendlyName("");
      setIpAddress("");
      setPort(9000);
      setSshPort(22);
      setSshUsername("");
      setSshPassword("");
    }
    setPhase("idle");
    setErrorMsg(null);
    setLogs([]);
  }, [open, mode, editing]);

  // Auto-scroll terminal
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    if (mode === "edit" && editing) {
      try {
        await updateHost(editing.id, { friendlyName, ipAddress, port });
        onClose();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    setPhase("provisioning");
    setLogs([]);

    try {
      const { sessionId } = await createHost({
        friendlyName,
        ipAddress,
        port,
        sshPort,
        sshUsername,
        sshPassword,
      });

      // Discard credentials immediately on the client side too
      setSshPassword("");

      const socket = getSocket();
      socket.emit("provision:subscribe", sessionId);

      const onLog = (log: ProvisionLog) => setLogs((prev) => [...prev, log]);
      const onDone = (result: ProvisionDone) => {
        socket.off("provision:log", onLog);
        socket.off("provision:done", onDone);
        socket.emit("provision:unsubscribe", sessionId);
        if (result.success) {
          setPhase("success");
          setTimeout(() => onClose(), 1800);
        } else {
          setPhase("error");
          setErrorMsg(result.error);
        }
      };
      socket.on("provision:log", onLog);
      socket.on("provision:done", onDone);
    } catch (err) {
      setPhase("error");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/60 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={phase === "provisioning" ? undefined : onClose}
          />
          <motion.aside
            className="fixed right-0 top-0 bottom-0 w-full max-w-xl glass z-50 flex flex-col"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 32 }}
          >
            <header className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-lg font-semibold">
                {mode === "edit" ? "Edit Host" : "Provision New Host"}
              </h2>
              <button
                onClick={onClose}
                disabled={phase === "provisioning"}
                className="p-2 rounded hover:bg-white/10 text-text-dim hover:text-text disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <X size={18} />
              </button>
            </header>

            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <Field label="Friendly Name">
                <input
                  required
                  value={friendlyName}
                  onChange={(e) => setFriendlyName(e.target.value)}
                  disabled={phase === "provisioning"}
                  placeholder="My Lab Radius"
                  className="input"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="IP Address">
                  <input
                    required
                    value={ipAddress}
                    onChange={(e) => setIpAddress(e.target.value)}
                    disabled={phase === "provisioning"}
                    placeholder="10.76.191.233"
                    className="input font-mono"
                  />
                </Field>
                <Field label="Service Port">
                  <input
                    required
                    type="number"
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                    disabled={phase === "provisioning"}
                    className="input font-mono"
                  />
                </Field>
              </div>

              {mode === "create" && (
                <>
                  <div className="pt-3 border-t border-border">
                    <h3 className="text-xs uppercase tracking-wider text-text-dim mb-3">
                      SSH Credentials (used once, never stored)
                    </h3>
                  </div>
                  <Field label="SSH Port">
                    <input
                      required
                      type="number"
                      value={sshPort}
                      onChange={(e) => setSshPort(Number(e.target.value))}
                      disabled={phase === "provisioning"}
                      className="input font-mono w-32"
                    />
                  </Field>
                  <Field label="SSH Username (with sudo)">
                    <input
                      required
                      value={sshUsername}
                      onChange={(e) => setSshUsername(e.target.value)}
                      disabled={phase === "provisioning"}
                      placeholder="ubuntu"
                      autoComplete="off"
                      className="input"
                    />
                  </Field>
                  <Field label="SSH Password">
                    <input
                      required
                      type="password"
                      value={sshPassword}
                      onChange={(e) => setSshPassword(e.target.value)}
                      disabled={phase === "provisioning"}
                      autoComplete="new-password"
                      className="input"
                    />
                  </Field>
                </>
              )}

              {errorMsg && (
                <div className="rounded-md border border-neon-red/40 bg-neon-red/10 px-3 py-2 text-sm text-neon-red flex items-start gap-2">
                  <XCircle size={16} className="mt-0.5 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {phase === "success" && (
                <div className="rounded-md border border-neon-green/40 bg-neon-green/10 px-3 py-2 text-sm text-neon-green flex items-center gap-2">
                  <CheckCircle2 size={16} />
                  Host provisioned and added to dashboard.
                </div>
              )}

              {logs.length > 0 && (
                <div className="rounded-md border border-border bg-black/40 p-3 max-h-64 overflow-y-auto font-mono text-xs">
                  {logs.map((l, i) => (
                    <div
                      key={i}
                      className={
                        l.level === "stderr"
                          ? "text-neon-red"
                          : l.level === "system"
                            ? "text-neon-blue"
                            : "text-text"
                      }
                    >
                      {l.line}
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              )}
            </form>

            <footer className="px-6 py-4 border-t border-border flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={phase === "provisioning"}
                className="px-4 py-2 rounded-md text-text-dim hover:text-text hover:bg-white/10 disabled:opacity-30"
              >
                Cancel
              </button>
              <button
                type="submit"
                onClick={handleSubmit}
                disabled={phase === "provisioning"}
                className="px-4 py-2 rounded-md bg-neon-blue/20 border border-neon-blue/50 text-neon-blue hover:bg-neon-blue/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {phase === "provisioning" && <Loader2 size={16} className="animate-spin" />}
                {mode === "edit"
                  ? "Save Changes"
                  : phase === "provisioning"
                    ? "Provisioning..."
                    : "Provision Host"}
              </button>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wider text-text-dim mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}
