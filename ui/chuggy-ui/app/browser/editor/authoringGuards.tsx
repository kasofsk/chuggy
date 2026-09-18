/**
 * What stands between an author with unsaved text and losing it.
 *
 * Two different exits need two different mechanisms. Leaving the tab is the
 * browser's to refuse, and it only honours a refusal raised from the event, so
 * `beforeunload` is registered while the text is dirty and removed when it is
 * not. Leaving by a route is the router's, and it can be asked, so that one
 * gets a question naming what would be lost.
 *
 * Neither is a save. They buy the author the chance to copy the text, which is
 * the only guarantee a console without a server-side draft can make.
 */

import { Component, useEffect } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { useBlocker } from "@tanstack/react-router";

/** The browser refuses the unload only if the handler is attached when it fires. */
export function useUnloadGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => {
      window.removeEventListener("beforeunload", guard);
    };
  }, [dirty]);
}

/** A route away from dirty text asks first, and the author's answer decides. */
export function useLeaveGuard(dirty: boolean): void {
  useBlocker({
    shouldBlockFn: () =>
      !window.confirm("Discard the unsaved ticket text and leave?"),
    enableBeforeUnload: false,
    disabled: !dirty,
  });
}

/**
 * The editor is a separate chunk, so its load is a request that can fail. A
 * failure is not a reason to lose the document: the same text stays editable
 * in a textarea, which is what the console had before the editor existed.
 */
export class EditorBoundary extends Component<
  { readonly fallback: ReactNode; readonly children: ReactNode },
  { readonly failed: boolean }
> {
  constructor(props: {
    readonly fallback: ReactNode;
    readonly children: ReactNode;
  }) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError(): { readonly failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    void error;
    void info;
  }
  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
