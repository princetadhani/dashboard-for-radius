"use client";

import { Check, ChevronDown, ChevronRight, Circle, Loader2, X } from "lucide-react";
import { useState } from "react";
import type { ProvisionLog, ProvisionStep } from "../lib/types";

type Status = "running" | "success" | "error";

type Props = {
  steps: ProvisionStep[];
  logs: ProvisionLog[];
  status: Status;
  errorMsg?: string | null;
};

export function Stepper({ steps, logs, status, errorMsg }: Props) {
  const [showLog, setShowLog] = useState(false);
  const stderrCount = logs.filter((l) => l.level === "stderr").length;
  const total = steps.length > 0 ? steps[steps.length - 1].total : 0;

  return (
    <div className="space-y-3">
      {steps.length > 0 && (
        <ol className="space-y-1.5">
          {steps.map((s, idx) => {
            const isLast = idx === steps.length - 1;
            const stepStatus: Status =
              isLast && status === "running"
                ? "running"
                : isLast && status === "error"
                  ? "error"
                  : "success";
            return <StepItem key={`${s.n}-${s.ts}`} step={s} status={stepStatus} />;
          })}
          {/* Pending placeholders for known total */}
          {total > 0 &&
            Array.from({ length: Math.max(0, total - steps.length) }).map((_, i) => (
              <li
                key={`pending-${i}`}
                className="flex items-center gap-3 text-text-dim text-sm"
              >
                <Circle size={14} className="shrink-0 opacity-40" />
                <span className="font-mono text-xs opacity-50">
                  [{steps.length + i + 1}/{total}]
                </span>
                <span className="opacity-50">Pending...</span>
              </li>
            ))}
        </ol>
      )}

      {status === "error" && errorMsg && (
        <div className="rounded-md border border-neon-red/40 bg-neon-red/10 px-3 py-2 text-sm text-neon-red flex items-start gap-2">
          <X size={16} className="mt-0.5 shrink-0" />
          <span className="break-all">{errorMsg}</span>
        </div>
      )}

      {logs.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowLog((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-text-dim hover:text-text"
          >
            {showLog ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {showLog ? "Hide" : "Show"} output ({logs.length} lines
            {stderrCount > 0 && (
              <span className="text-neon-red">, {stderrCount} stderr</span>
            )}
            )
          </button>
          {showLog && (
            <div className="mt-2 rounded-md border border-border bg-black/40 p-3 max-h-64 overflow-y-auto font-mono text-xs">
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StepItem({ step, status }: { step: ProvisionStep; status: Status }) {
  const icon =
    status === "success" ? (
      <Check size={14} className="text-neon-green shrink-0" />
    ) : status === "error" ? (
      <X size={14} className="text-neon-red shrink-0" />
    ) : (
      <Loader2 size={14} className="text-neon-blue shrink-0 animate-spin" />
    );
  const textCls =
    status === "success"
      ? "text-text-dim"
      : status === "error"
        ? "text-neon-red"
        : "text-text";
  return (
    <li className="flex items-center gap-3 text-sm">
      {icon}
      <span className="font-mono text-xs text-text-dim">
        [{step.n}/{step.total}]
      </span>
      <span className={textCls}>{step.label}</span>
    </li>
  );
}
