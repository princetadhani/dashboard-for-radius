"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Network } from "lucide-react";
import { CopyText } from "./CopyText";

type Props = {
  primaryIp: string;
  knownIps: string[];
};

export function IpAddressDisplay({ primaryIp, knownIps }: Props) {
  const [showPopover, setShowPopover] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Additional IPs (excluding primaryIp which is always shown in the main column)
  const additionalIps = (knownIps || []).filter(ip => ip !== primaryIp);
  const hasAdditionalIps = additionalIps.length > 0;

  useEffect(() => {
    if (!showPopover) return;

    function handleClickOutside(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setShowPopover(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showPopover]);

  function togglePopover() {
    if (!buttonRef.current) return;

    if (!showPopover) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPopoverPos({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
      });
    }
    setShowPopover(!showPopover);
  }

  if (!hasAdditionalIps) {
    // Only one IP - simple display with copy
    return (
      <div className="flex items-center gap-2 min-w-0">
        <CopyText value={primaryIp} label="Copy address" className="min-w-0">
          {primaryIp}
        </CopyText>
      </div>
    );
  }

  // Multiple IPs - show active IP with badge for additional ones
  return (
    <>
      <div className="flex items-center gap-2 min-w-0">
        <CopyText value={primaryIp} label="Copy address" className="min-w-0">
          {primaryIp}
        </CopyText>
        <button
          ref={buttonRef}
          onClick={togglePopover}
          className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-neon-blue/20 text-neon-blue border border-neon-blue/30 hover:bg-neon-blue/30 transition-colors"
          title={`${additionalIps.length} additional IP${additionalIps.length > 1 ? 's' : ''} detected`}
        >
          <Network size={12} className="inline mr-1" />
          +{additionalIps.length}
        </button>
      </div>

      {showPopover &&
        popoverPos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              position: "absolute",
              top: popoverPos.top,
              left: popoverPos.left,
              zIndex: 9999,
            }}
            className="w-67 popover rounded-md p-3"
          >
            <div className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-3">
              Additional IP Addresses
            </div>
            <div className="space-y-2">
              {additionalIps.map((ip) => {
                return (
                  <div
                    key={ip}
                    className="p-2 rounded-md bg-white/5 hover:bg-white/10 transition-colors overflow-hidden"
                  >
                    <div className="min-w-0 overflow-hidden">
                      <CopyText
                        value={ip}
                        label="Copy IP"
                        className="font-mono text-sm w-full"
                        textClassName="block truncate"
                      >
                        {ip}
                      </CopyText>
                      <div className="text-[10px] text-text-dim mt-0.5">
                        Discovered interface
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 pt-2 border-t border-border text-[10px] text-text-dim">
              <p>
                These are additional IP addresses discovered on this host.
                The system automatically uses the most reachable IP for monitoring.
              </p>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
