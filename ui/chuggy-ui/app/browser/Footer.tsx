/**
 * The line the bar above every page ends on, and the one the landing route ends
 * on — that route assembles its own markup and never mounts `Shell`.
 */

import type { ReactNode } from "react";

export function Footer(): ReactNode {
  return <footer className="text-xs text-ink-3">Copyright 2026. Chuggy</footer>;
}
