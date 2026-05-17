"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import type {
  Host,
  ProvisionDone,
  ProvisionLog,
  ProvisionStep,
  SshActionType,
} from "../lib/types";
import { runHostAction } from "../lib/api";
import { getSocket } from "../lib/socket";
import { Stepper } from "./Stepper";
import { PasswordInput } from "./PasswordInput";

type Props = {
  open: boolean;
  action: SshActionType | null;
  host: Host | null;
  onClose: () => void;
  latestVersion?: string | null;
};

const ACTION_LABELS: Record<SshActionType, { title: string; verb: string }> = {
  reinstall: { title: "Reinstall / Repair", verb: "Reinstall" },
  "restart-service": { title: "Restart FreeRADIUS", verb: "Restart" },
  "update-script": { title: "Update via Latest Script", verb: "Update" },
};

type Phase = "idle" | "running" | "success" | "error";

export function SshActionModal({ open, action, host, onClose, latestVersion }: Props) {
  const [sshPort, setSshPort] = useState(22);
  const [sshUsername, setSshUsername] = useState("");
  const [sshPassword, setSshPassword] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [logs, setLogs] = useState<ProvisionLog[]>([]);
  const [steps, setSteps] = useState<ProvisionStep[]>([]);

  useEffect(() => {
    if (!open) return;
    setSshPort(22);
    setSshUsername("");
    setSshPassword("");
    setPhase("idle");
    setErrorMsg(null);
    setLogs([]);
    setSteps([]);
  }, [open]);

  if (!action || !host) return null;
  const meta = ACTION_LABELS[action];
  const hasUpdate = !!(action === "reinstall" && host.installedVersion && latestVersion && host.installedVersion !== latestVersion);
  const title = hasUpdate ? `Update to ${latestVersion}` : meta.title;
  const verb = hasUpdate ? `Update to ${latestVersion}` : meta.verb;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!action || !host) return;
    setErrorMsg(null);
    setPhase("running");
    setLogs([]);
    setSteps([]);

    const creds = { sshPort, sshUsername, sshPassword };
    const socket = getSocket();

    try {
      const { sessionId } = await runHostAction(host.id, action, creds);
      setSshPassword("");
      socket.emit("provision:subscribe", sessionId);

      let finalized = false;

      const onLog = (l: ProvisionLog) => {
        if (l.sessionId && l.sessionId !== sessionId) return;
        setLogs((prev) => [...prev, l]);
      };
      const onStep = (s: ProvisionStep) => {
        if (s.sessionId && s.sessionId !== sessionId) return;
        setSteps((prev) => [...prev, s]);
      };
      const onDone = (d: ProvisionDone) => {
        if (d.sessionId && d.sessionId !== sessionId) return;
        if (finalized) return;
        finalized = true;

        socket.off("provision:log", onLog);
        socket.off("provision:step", onStep);
        socket.off("provision:done", onDone);
        socket.emit("provision:unsubscribe", sessionId);

        if (d.success) {
          setPhase("success");
          toast.success(`${verb} succeeded on ${host.friendlyName}`);
          setTimeout(() => onClose(), 1800);
        } else {
          setPhase("error");
          setErrorMsg(d.error);
          toast.error(`${verb} failed: ${d.error}`);
        }
      };

      socket.on("provision:log", onLog);
      socket.on("provision:step", onStep);
      socket.on("provision:done", onDone);
    } catch (err) {
      setPhase("error");
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      toast.error(msg);
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
            onClick={phase === "running" ? undefined : onClose}
          />
          <motion.aside
            className="fixed right-0 top-0 bottom-0 w-full max-w-2xl panel z-50 flex flex-col shadow-2xl"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 32 }}
          >
            <header className="flex items-center justify-between px-6 py-4 border-b border-border gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold truncate">{title}</h2>
                <p
                  className="text-xs text-text-dim mt-0.5 truncate"
                  title={host.friendlyName}
                >
                  Target: {host.friendlyName}
                </p>
              </div>
              <button
                onClick={onClose}
                disabled={phase === "running"}
                className="p-2 rounded hover:bg-white/10 text-text-dim hover:text-text disabled:opacity-30"
              >
                <X size={18} />
              </button>
            </header>

            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-3 border-b border-border">
              <div className="grid grid-cols-3 gap-3">
                <label className="block">
                  <span className="block text-xs uppercase tracking-wider text-text-dim mb-1.5">
                    SSH Port
                  </span>
                  <input
                    required
                    type="number"
                    value={sshPort}
                    onChange={(e) => setSshPort(Number(e.target.value))}
                    disabled={phase === "running"}
                    className="input w-full font-mono"
                  />
                </label>
                <label className="block col-span-2">
                  <span className="block text-xs uppercase tracking-wider text-text-dim mb-1.5">
                    Username (sudo)
                  </span>
                  <input
                    required
                    value={sshUsername}
                    onChange={(e) => setSshUsername(e.target.value)}
                    disabled={phase === "running"}
                    autoComplete="off"
                    className="input w-full"
                  />
                </label>
              </div>
              <label className="block">
                <span className="block text-xs uppercase tracking-wider text-text-dim mb-1.5">
                  Password (used once, never stored)
                </span>
                <PasswordInput
                  required
                  value={sshPassword}
                  onChange={(e) => setSshPassword(e.target.value)}
                  disabled={phase === "running"}
                  autoComplete="new-password"
                />
              </label>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={phase === "running"}
                  className="px-4 py-2 rounded-md text-text-dim hover:text-text hover:bg-white/10 disabled:opacity-30"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={phase === "running" || phase === "success"}
                  className="px-4 py-2 rounded-md bg-neon-blue/20 border border-neon-blue/50 text-neon-blue hover:bg-neon-blue/30 disabled:opacity-50 flex items-center gap-2 text-sm"
                >
                  {phase === "running" && <Loader2 size={14} className="animate-spin" />}
                  {phase === "running" ? "Running..." : meta.verb}
                </button>
              </div>
            </form>

            {(phase === "running" || phase === "success" || phase === "error") && (
              <div className="flex-1 overflow-y-auto p-4">
                <Stepper
                  steps={steps}
                  logs={logs}
                  status={
                    phase === "running"
                      ? "running"
                      : phase === "success"
                        ? "success"
                        : "error"
                  }
                  errorMsg={errorMsg}
                />
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
