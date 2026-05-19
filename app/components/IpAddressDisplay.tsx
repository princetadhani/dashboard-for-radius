"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Network, Globe, AlertTriangle } from "lucide-react";
import { CopyText } from "./CopyText";

function DnsFailGlobe() {
  return (
    <span className="relative inline-flex items-center group cursor-default">
      <Globe size={12} className="text-red-500 shrink-0" />
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 text-[11px] text-white whitespace-nowrap rounded-xl border border-white/25 backdrop-blur-md bg-white/10 shadow-[0_8px_20px_rgba(0,0,0,0.4),inset_0_0_10px_rgba(255,255,255,0.08)] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 pointer-events-none z-[9999]">
        DNS resolution failed — this hostname could not be resolved
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-[5px] border-transparent border-t-white/25" />
      </span>
    </span>
  );
}

type Props = {
  primaryIp: string;
  knownIps: string[];
  resolvedIps?: string[];
};

export function IpAddressDisplay({ primaryIp, knownIps, resolvedIps }: Props) {
  const [showPopover, setShowPopover] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // IPs discovered on the host's interfaces (excluding the primary shown in the column)
  const additionalIps = (knownIps || []).filter(ip => ip !== primaryIp);

  // IPs the hostname resolved to that are NOT in knownIps — meaning the DNS record
  // points to an IP not found on any discovered interface (NAT, stale record, etc.)
  const dnsOnlyIps = (resolvedIps ?? []).filter(
    ip => ip !== primaryIp && !(knownIps || []).includes(ip)
  );

  const totalCount = additionalIps.length + dnsOnlyIps.length;
  const hasAdditionalIps = totalCount > 0;

  // resolvedIps defined (hostname was entered) but empty = DNS resolution failed
  const dnsFailed = resolvedIps !== undefined && resolvedIps.length === 0;

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
    return (
      <div className="flex items-center gap-2 min-w-0">
        <CopyText value={primaryIp} label="Copy address" className="min-w-0">
          {primaryIp}
        </CopyText>
        {dnsFailed && (
          <DnsFailGlobe />
        )}
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2 min-w-0">
        <CopyText value={primaryIp} label="Copy address" className="min-w-0">
          {primaryIp}
        </CopyText>
        {dnsFailed && (
          <DnsFailGlobe />
        )}
        <span className="relative inline-flex items-center group/badge">
          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 text-[11px] text-white whitespace-nowrap rounded-xl border border-white/25 backdrop-blur-md bg-white/10 shadow-[0_8px_20px_rgba(0,0,0,0.4),inset_0_0_10px_rgba(255,255,255,0.08)] opacity-0 invisible group-hover/badge:opacity-100 group-hover/badge:visible transition-all duration-150 pointer-events-none z-[9999]">
            {totalCount} additional IP{totalCount > 1 ? 's' : ''} detected on this radius server
            <span className="absolute top-full left-1/2 -translate-x-1/2 border-[5px] border-transparent border-t-white/25" />
          </span>
          <button
            ref={buttonRef}
            onClick={togglePopover}
            className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-neon-blue/20 text-neon-blue border border-neon-blue/30 hover:bg-neon-blue/30 transition-colors"
          >
            <Network size={12} className="inline mr-1" />
            +{totalCount}
          </button>
        </span>
      </div>

      {showPopover &&
        popoverPos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popoverRef}
            style={{ position: "absolute", top: popoverPos.top, left: popoverPos.left, zIndex: 9999 }}
            className="w-72 popover rounded-md p-3"
          >
            <div className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-3">
              Additional IP Addresses
            </div>

            <div className="space-y-2">
              {/* Discovered interface IPs */}
              {additionalIps.map((ip) => {
                const isResolved = resolvedIps?.includes(ip);
                return (
                  <div
                    key={ip}
                    className={`p-2 rounded-md overflow-hidden ${isResolved ? "bg-neon-green/10 border border-neon-green/25" : "bg-white/5"}`}
                  >
                    <CopyText value={ip} label="Copy IP" className="font-mono text-sm max-w-full">
                      {ip}
                    </CopyText>
                    <div className="flex items-center gap-1 mt-0.5">
                      {isResolved ? (
                        <>
                          <Globe size={9} className="text-neon-green shrink-0" />
                          <span className="text-[10px] text-neon-green font-medium">
                            IP Resolved from hostname
                          </span>
                        </>
                      ) : (
                        <span className="text-[10px] text-text-dim">Discovered interface</span>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* DNS-only IPs — resolved but not found on any discovered interface */}
              {dnsOnlyIps.map((ip) => (
                <div key={ip} className="p-2 rounded-md overflow-hidden bg-yellow-500/10 border border-yellow-500/25">
                  <CopyText value={ip} label="Copy IP" className="font-mono text-sm max-w-full">
                    {ip}
                  </CopyText>
                  <div className="flex items-center gap-1 mt-0.5">
                    <AlertTriangle size={9} className="text-yellow-400 shrink-0" />
                    <span className="text-[10px] text-yellow-400 font-medium">
                      Resolved by DNS, IP missing on radius-server
                    </span>
                  </div>
                </div>
              ))}
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
