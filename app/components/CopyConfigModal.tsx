"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, CheckCircle2, Copy, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import type { Host, ProvisionDone, ProvisionLog, ProvisionStep } from "../lib/types";
// import { copyConfig } from "../lib/api";
import { getSocket } from "../lib/socket";
import { Select } from "./Select";
import { Stepper } from "./Stepper";
import { PasswordInput } from "./PasswordInput";

type Props = {
  source: Host | null;
  hosts: Host[];
  onClose: () => void;
};

type Phase = "idle" | "running" | "success" | "error";

type Creds = { sshPort: number; sshUsername: string; sshPassword: string };

const blankCreds = (): Creds => ({ sshPort: 22, sshUsername: "", sshPassword: "" });

export function CopyConfigModal({ source, hosts, onClose }: Props) {
  const [targetId, setTargetId] = useState<string>("");
  const [sameCreds, setSameCreds] = useState(true);
  const [src, setSrc] = useState<Creds>(blankCreds());
  const [tgt, setTgt] = useState<Creds>(blankCreds());
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [logs, setLogs] = useState<ProvisionLog[]>([]);
  const [steps, setSteps] = useState<ProvisionStep[]>([]);

  useEffect(() => {
    if (!source) return;
    setTargetId("");
    setSameCreds(true);
    setSrc(blankCreds());
    setTgt(blankCreds());
    setPhase("idle");
    setErrorMsg(null);
    setLogs([]);
    setSteps([]);
  }, [source]);

  if (!source) return null;
  const open = source !== null;
  const target = hosts.find((h) => h.id === targetId) ?? null;
  const candidateTargets = hosts.filter((h) => h.id !== source.id);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!source || !target) return;
    setErrorMsg(null);
    setPhase("running");
    setLogs([]);
    setSteps([]);

    const targetCreds = sameCreds ? src : tgt;

    try {
      // const { sessionId } = await copyConfig(source.id, {
      //   targetHostId: target.id,
      //   source: src,
      //   target: targetCreds,
      // });
      const sessionId = "";
      setSrc((c) => ({ ...c, sshPassword: "" }));
      setTgt((c) => ({ ...c, sshPassword: "" }));

      const socket = getSocket();
      socket.emit("provision:subscribe", sessionId);

      const onLog = (log: ProvisionLog) => {
        if (log.sessionId && log.sessionId !== sessionId) return;
        setLogs((prev) => [...prev, log]);
      };
      const onStep = (step: ProvisionStep) => {
        if (step.sessionId && step.sessionId !== sessionId) return;
        setSteps((prev) => [...prev, step]);
      };
      const onDone = (d: ProvisionDone) => {
        if (d.sessionId && d.sessionId !== sessionId) return;
        socket.off("provision:log", onLog);
        socket.off("provision:step", onStep);
        socket.off("provision:done", onDone);
        socket.emit("provision:unsubscribe", sessionId);
        if (d.success) {
          setPhase("success");
          toast.success(`Config copied: ${source.friendlyName} → ${target.friendlyName}`);
          setTimeout(() => onClose(), 1800);
        } else {
          setPhase("error");
          setErrorMsg(d.error);
          toast.error(`Copy failed: ${d.error}`);
        }
      };
      socket.on("provision:log", onLog);
      socket.on("provision:step", onStep);
      socket.on("provision:done", onDone);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPhase("error");
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
              <div className="flex items-start gap-2 min-w-0 flex-1">
                <Copy size={18} className="text-neon-blue mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold">Copy FreeRADIUS Config</h2>
                  <p className="text-xs text-text-dim mt-0.5">
                    Tarballs <span className="font-mono">/etc/freeradius/3.0</span> from source
                    and restores it on target. Target's existing config is backed up before overwrite.
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                disabled={phase === "running"}
                className="p-2 rounded hover:bg-white/10 text-text-dim hover:text-text disabled:opacity-30 shrink-0"
              >
                <X size={18} />
              </button>
            </header>

            <form
              onSubmit={handleSubmit}
              className="flex-1 overflow-y-auto px-6 py-5 space-y-5"
            >
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0 panel rounded-lg p-3 border border-neon-blue/30">
                  <div className="text-[10px] uppercase tracking-wider text-text-dim mb-1">
                    Source
                  </div>
                  <div className="font-medium truncate" title={source.friendlyName}>
                    {source.friendlyName}
                  </div>
                  <div className="text-xs font-mono text-text-dim truncate">
                    {source.ipAddress}
                  </div>
                </div>
                <ArrowRight className="text-neon-blue shrink-0" size={20} />
                <div className="flex-1 min-w-0">
                  <span className="block text-[10px] uppercase tracking-wider text-text-dim mb-1">
                    Target
                  </span>
                  <Select<string>
                    value={targetId}
                    onChange={setTargetId}
                    disabled={phase === "running"}
                    placeholder="Select target host..."
                    options={candidateTargets.map((h) => ({
                      value: h.id,
                      label: `${h.friendlyName} (${h.ipAddress})`,
                    }))}
                  />
                </div>
              </div>

              <CredsForm
                title="Source SSH credentials"
                creds={src}
                onChange={setSrc}
                disabled={phase === "running"}
              />

              <label className="flex items-center gap-2 text-sm text-text-dim cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={sameCreds}
                  onChange={(e) => setSameCreds(e.target.checked)}
                  disabled={phase === "running"}
                  className="cursor-pointer accent-neon-blue"
                />
                Target uses the same SSH credentials
              </label>

              {!sameCreds && (
                <CredsForm
                  title="Target SSH credentials"
                  creds={tgt}
                  onChange={setTgt}
                  disabled={phase === "running"}
                />
              )}

              {phase === "success" && (
                <div className="rounded-md border border-neon-green/40 bg-neon-green/10 px-3 py-2 text-sm text-neon-green flex items-center gap-2">
                  <CheckCircle2 size={16} />
                  Config copied and FreeRADIUS restarted on target.
                </div>
              )}

              {(phase === "running" || phase === "success" || phase === "error") && (
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
              )}
            </form>

            <footer className="px-6 py-4 border-t border-border flex items-center justify-end gap-2">
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
                onClick={handleSubmit}
                disabled={phase === "running" || phase === "success" || !targetId}
                className="px-4 py-2 rounded-md bg-neon-blue/20 border border-neon-blue/50 text-neon-blue hover:bg-neon-blue/30 disabled:opacity-50 flex items-center gap-2 text-sm"
              >
                {phase === "running" && <Loader2 size={14} className="animate-spin" />}
                {phase === "running" ? "Copying..." : "Copy & Restart"}
              </button>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function CredsForm({
  title,
  creds,
  onChange,
  disabled,
}: {
  title: string;
  creds: Creds;
  onChange: (c: Creds) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs uppercase tracking-wider text-text-dim">{title}</h3>
      <div className="grid grid-cols-3 gap-3">
        <label className="block">
          <span className="block text-xs uppercase tracking-wider text-text-dim mb-1.5">
            SSH Port
          </span>
          <input
            required
            type="number"
            value={creds.sshPort}
            onChange={(e) => onChange({ ...creds, sshPort: Number(e.target.value) })}
            disabled={disabled}
            className="input w-full font-mono"
          />
        </label>
        <label className="block col-span-2">
          <span className="block text-xs uppercase tracking-wider text-text-dim mb-1.5">
            Username (sudo)
          </span>
          <input
            required
            value={creds.sshUsername}
            onChange={(e) => onChange({ ...creds, sshUsername: e.target.value })}
            disabled={disabled}
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
          value={creds.sshPassword}
          onChange={(e) => onChange({ ...creds, sshPassword: e.target.value })}
          disabled={disabled}
          autoComplete="new-password"
        />
      </label>
    </div>
  );
}
