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
 * Sub-phase starts when n resets to 1 after n > 1.
 * Return to outer requires (outerN+1, outerTotal) exact match so sub-script
 * steps that exceed the outer watermark aren't mis-classified as outer.
 */
function buildPhaseGroups(all: ProvisionStep[]): PhaseGroup[] {
  if (all.length === 0) return [];

  const groups: PhaseGroup[] = [];
  let buf: ProvisionStep[] = [all[0]];
  let nested = false;
  let outerN = all[0].n;
  let outerTotal = all[0].total;

  for (let i = 1; i < all.length; i++) {
    const s = all[i];
    const prev = buf[buf.length - 1]!;

    if (s.n === 1 && prev.n > 1 && !nested) {
      // Sub-script restarted its own counter from 1
      groups.push({ steps: buf, nested: false });
      buf = [s];
      nested = true;
    } else if (nested && s.n === outerN + 1 && s.total === outerTotal) {
      // Outer script resumed with exactly the next expected (n, total) pair
      groups.push({ steps: buf, nested: true });
      buf = [s];
      nested = false;
      outerN = s.n;
      outerTotal = s.total;
    } else {
      if (!nested) {
        outerN = s.n;
        outerTotal = s.total;
      }
      buf.push(s);
    }
  }

  groups.push({ steps: buf, nested });
  return groups;
}

type RenderStep = {
  step: ProvisionStep;
  nested: boolean;
  displayN: number;
  displayTotal: number;
  stepStatus: Status;
};

export function Stepper({ steps, logs, status, errorMsg }: Props) {
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.length]);

  const groups = buildPhaseGroups(steps);
  const outerSteps = groups.filter((g) => !g.nested).flatMap((g) => g.steps);
  const lastOuter = outerSteps[outerSteps.length - 1];
  const lastGroup = groups[groups.length - 1];
  const currentStep = lastGroup?.steps[lastGroup.steps.length - 1];

  // Canonical total settles to the last outer step's total (e.g. 5 once [3/5] arrives).
  // React re-renders everything, so earlier [1/6]/[2/6] auto-correct to [1/5]/[2/5].
  const canonicalTotal = lastOuter?.total ?? 0;
  const progressN = outerSteps.length;
  const progressPct = canonicalTotal > 0 ? Math.round((progressN / canonicalTotal) * 100) : 0;

  const lastGroupIsNested = lastGroup?.nested ?? false;
  const pendingCount =
    status === "running" && !lastGroupIsNested && canonicalTotal > 0
      ? Math.max(0, canonicalTotal - outerSteps.length)
      : 0;

  // Pre-compute flat render list to avoid mutable counters inside JSX
  const totalStepCount = groups.reduce((acc, g) => acc + g.steps.length, 0);
  let outerIdx = 0;
  let globalIdx = 0;
  const renderSteps: RenderStep[] = groups.flatMap((group) =>
    group.steps.map((s) => {
      globalIdx++;
      const isOverallLast = globalIdx === totalStepCount;
      const stepStatus: Status =
        isOverallLast && status === "running"
          ? "running"
          : isOverallLast && status === "error"
            ? "error"
            : "success";
      return {
        step: s,
        nested: group.nested,
        // Outer steps use position index + canonical total; sub-steps keep their own
        displayN: group.nested ? s.n : ++outerIdx,
        displayTotal: group.nested ? s.total : canonicalTotal,
        stepStatus,
      };
    })
  );

  const progressColor =
    status === "success"
      ? "bg-neon-green"
      : status === "error"
        ? "bg-neon-red"
        : "bg-neon-blue";

  return (
    <div className="flex flex-col gap-3">
      {/* ── Progress bar ── */}
      {canonicalTotal > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-text-dim font-mono truncate pr-3 max-w-[80%]">
              {status === "success"
                ? `All ${canonicalTotal} steps complete`
                : status === "error"
                  ? `Failed at step ${progressN} of ${canonicalTotal}`
                  : currentStep
                    ? currentStep.label
                    : "Starting…"}
            </span>
            <span className="text-xs font-mono tabular text-text-dim shrink-0">
              {progressN}/{canonicalTotal}
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

      {/* ── Step list ── */}
      {renderSteps.length > 0 && (
        <ol className="space-y-1">
          {renderSteps.map(({ step, nested, displayN, displayTotal, stepStatus }, i) => (
            <StepItem
              key={`${i}-${step.ts}`}
              step={step}
              status={stepStatus}
              nested={nested}
              displayN={displayN}
              displayTotal={displayTotal}
            />
          ))}

          {/* Pending outer-step placeholders */}
          {Array.from({ length: pendingCount }).map((_, i) => (
            <li key={`pending-${i}`} className="flex items-center gap-2.5">
              <Circle size={13} className="shrink-0 text-white/20" />
              <span className="font-mono text-xs text-white/20">
                [{outerSteps.length + i + 1}/{canonicalTotal}]
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

      {/* ── Terminal panel ── */}
      {logs.length > 0 && (
        <div className="rounded-md border border-border overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 border-b border-border">
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
  displayN,
  displayTotal,
}: {
  step: ProvisionStep;
  status: Status;
  nested: boolean;
  displayN: number;
  displayTotal: number;
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
      <span className={`font-mono text-xs shrink-0 ${nested ? "text-white/25" : "text-text-dim"}`}>
        [{displayN}/{displayTotal}]
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
