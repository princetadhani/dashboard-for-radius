"use client";

import { useEffect, useRef } from "react";
import { Check, Circle, Loader2, X } from "lucide-react";
import type { ProvisionLog, ProvisionStep } from "../lib/types";

type Status = "running" | "success" | "error";

type Props = {
  steps: ProvisionStep[];
  logs: ProvisionLog[];
  status: Status;
  errorMsg?: string | null;
};

type PhaseGroup = { steps: ProvisionStep[]; nested: boolean };

/**
 * Groups steps into outer and nested phases.
 * When n resets to 1 after n > 1, a sub-script started — mark those as nested.
 * When n exceeds the outer watermark again, we've returned to the outer script.
 */
function buildPhaseGroups(all: ProvisionStep[]): PhaseGroup[] {
  if (all.length === 0) return [];

  const groups: PhaseGroup[] = [];
  let buf: ProvisionStep[] = [all[0]];
  let nested = false;
  let outerN = all[0].n;

  for (let i = 1; i < all.length; i++) {
    const s = all[i];
    const prev = buf[buf.length - 1]!;

    if (s.n === 1 && prev.n > 1 && !nested) {
      // Sub-script started its own counter
      groups.push({ steps: buf, nested: false });
      buf = [s];
      nested = true;
    } else if (nested && s.n > outerN) {
      // Outer script resumed with a higher n
      groups.push({ steps: buf, nested: true });
      buf = [s];
      nested = false;
      outerN = s.n;
    } else {
      if (!nested) outerN = s.n;
      buf.push(s);
    }
  }

  groups.push({ steps: buf, nested });
  return groups;
}

export function Stepper({ steps, logs, status, errorMsg }: Props) {
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll terminal to bottom on new log lines
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.length]);

  const groups = buildPhaseGroups(steps);
  const outerSteps = groups.filter((g) => !g.nested).flatMap((g) => g.steps);
  const lastOuter = outerSteps[outerSteps.length - 1];
  const lastGroup = groups[groups.length - 1];
  const currentStep = lastGroup?.steps[lastGroup.steps.length - 1];

  // Progress derived from the outer script's counter only
  const progressN = lastOuter ? Math.min(lastOuter.n, lastOuter.total) : 0;
  const progressTotal = lastOuter?.total ?? 0;
  const progressPct = progressTotal > 0 ? Math.round((progressN / progressTotal) * 100) : 0;

  // Pending outer steps: only show when we're still in an outer group
  const lastGroupIsNested = lastGroup?.nested ?? false;
  const pendingCount =
    status === "running" && !lastGroupIsNested && lastOuter
      ? Math.max(0, lastOuter.total - lastOuter.n)
      : 0;

  // Overall last step index (for status icon assignment)
  const totalStepCount = groups.reduce((acc, g) => acc + g.steps.length, 0);
  let stepCounter = 0;

  const progressColor =
    status === "success"
      ? "bg-neon-green"
      : status === "error"
        ? "bg-neon-red"
        : "bg-neon-blue";

  return (
    <div className="flex flex-col gap-3">
      {/* ── Progress bar ── */}
      {progressTotal > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-text-dim font-mono truncate pr-3 max-w-[80%]">
              {status === "success"
                ? `All ${progressTotal} steps complete`
                : status === "error"
                  ? `Failed at step ${progressN} of ${progressTotal}`
                  : currentStep
                    ? currentStep.label
                    : "Starting…"}
            </span>
            <span className="text-xs font-mono tabular-nums text-text-dim shrink-0">
              {progressN}/{progressTotal}
            </span>
          </div>
          <div className="h-1 rounded-full bg-white/10 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${progressColor}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Step list (outer + nested) ── */}
      {groups.length > 0 && (
        <ol className="space-y-1">
          {groups.map((group, gi) =>
            group.steps.map((s, _si) => {
              stepCounter++;
              const isOverallLast = stepCounter === totalStepCount;
              const stepStatus: Status =
                isOverallLast && status === "running"
                  ? "running"
                  : isOverallLast && status === "error"
                    ? "error"
                    : "success";
              return (
                <StepItem
                  key={`${gi}-${s.n}-${s.ts}`}
                  step={s}
                  status={stepStatus}
                  nested={group.nested}
                />
              );
            })
          )}

          {/* Pending placeholders for remaining outer steps */}
          {Array.from({ length: pendingCount }).map((_, i) => (
            <li key={`pending-${i}`} className="flex items-center gap-2.5">
              <Circle size={13} className="shrink-0 text-white/20" />
              <span className="font-mono text-xs text-white/20">
                [{(lastOuter?.n ?? 0) + i + 1}/{progressTotal}]
              </span>
              <span className="text-xs text-white/20">Pending</span>
            </li>
          ))}
        </ol>
      )}

      {/* ── Error banner ── */}
      {status === "error" && errorMsg && (
        <div className="rounded border border-neon-red/40 bg-neon-red/10 px-3 py-2 text-xs text-neon-red flex items-start gap-2">
          <X size={13} className="mt-0.5 shrink-0" />
          <span className="break-all font-mono">{errorMsg}</span>
        </div>
      )}

      {/* ── Terminal panel (always visible, auto-scrolls) ── */}
      {logs.length > 0 && (
        <div className="rounded-md border border-border overflow-hidden">
          {/* Title bar */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 border-b border-border">
            <span className="flex gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
              <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
              <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
            </span>
            <span className="text-xs text-text-dim font-mono ml-1 flex-1">
              console output
            </span>
            {status === "running" && (
              <span className="flex items-center gap-1 text-xs text-neon-blue">
                <Loader2 size={10} className="animate-spin" />
                live
              </span>
            )}
            {status === "success" && (
              <span className="text-xs text-neon-green font-mono">done</span>
            )}
            {status === "error" && (
              <span className="text-xs text-neon-red font-mono">error</span>
            )}
          </div>

          {/* Log body */}
          <div
            ref={logRef}
            className="overflow-y-auto bg-black/60 p-3 font-mono text-xs leading-relaxed"
            style={{ maxHeight: 260 }}
          >
            {logs.map((l, i) => (
              <div
                key={i}
                className={
                  l.level === "stderr"
                    ? "text-neon-red"
                    : l.level === "system"
                      ? "text-neon-blue"
                      : "text-text/80"
                }
              >
                {l.line}
              </div>
            ))}
            {status === "running" && (
              <span className="inline-block w-[7px] h-[13px] align-middle bg-neon-blue/70 animate-pulse" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StepItem({
  step,
  status,
  nested,
}: {
  step: ProvisionStep;
  status: Status;
  nested: boolean;
}) {
  const icon =
    status === "success" ? (
      <Check size={13} className={nested ? "text-neon-green/50 shrink-0" : "text-neon-green shrink-0"} />
    ) : status === "error" ? (
      <X size={13} className="text-neon-red shrink-0" />
    ) : (
      <Loader2 size={13} className="text-neon-blue shrink-0 animate-spin" />
    );

  return (
    <li className={`flex items-center gap-2.5 ${nested ? "ml-5" : ""}`}>
      {icon}
      <span
        className={`font-mono text-xs shrink-0 ${nested ? "text-white/25" : "text-text-dim"}`}
      >
        [{step.n}/{step.total}]
      </span>
      <span
        className={
          nested
            ? "text-xs text-white/40"
            : status === "success"
              ? "text-xs text-text-dim"
              : status === "error"
                ? "text-xs text-neon-red"
                : "text-xs text-text"
        }
      >
        {step.label}
      </span>
    </li>
  );
}
