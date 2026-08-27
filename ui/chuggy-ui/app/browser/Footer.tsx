/**
 * The line every page ends on, including the landing route, which assembles
 * its own shell markup and never mounts `Shell`.
 */

import type { ReactNode } from "react";

export function Footer(): ReactNode {
  return <footer className="footer">Copyright 2026. Chuggy</footer>;
}
