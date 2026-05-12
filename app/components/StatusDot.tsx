"use client";

type Props = {
  state: "up" | "down" | "unknown";
  title?: string;
};

export function StatusDot({ state, title }: Props) {
  const cls =
    state === "up" ? "dot dot-green" : state === "down" ? "dot dot-red" : "dot dot-gray";
  return <span className={cls} title={title} aria-label={title} />;
}
