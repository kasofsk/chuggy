/** The line a page outside every project ends on: the landing, a new project
 * and the forge's two returns. The shell around a project draws none. */

import type { ReactNode } from "react";

import { useCopyText } from "../copy/CopyProvider.tsx";

export function Footer(): ReactNode {
  const text = useCopyText();
  return (
    <footer className="text-xs text-ink-3">
      {text({ id: "shell-footer" })}
    </footer>
  );
}
