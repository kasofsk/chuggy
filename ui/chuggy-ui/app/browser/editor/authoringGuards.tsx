/**
 * What stands between an author with unsaved text and losing it.
 *
 * Two different exits need two different mechanisms. Leaving the tab is the
 * browser's to refuse, and it only honours a refusal raised from the event, so
 * `beforeunload` is registered while the text is dirty and removed when it is
 * not. Leaving by a route is the router's, and it can be asked, so that one
 * gets a question naming what would be lost.
 *
 * Neither is a save. The YAML an author was typing is also kept in this
 * browser's storage, which is the only other guarantee a console without a
 * server-side scratch copy can make.
 */

import { useBlocker } from "@tanstack/react-router";
import { Component, useEffect, useRef } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";

/** The browser refuses the unload only if the handler is attached when it fires. */
function useUnloadGuard(dirty: boolean): void {
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

/**
 * Both guards over one screen's dirtiness. A route away asks first and the
 * author's answer decides, except after `release`: the navigation a settled
 * submit makes is the one exit the text is not lost by, and it happens before
 * a render could clear the dirtiness it would otherwise be asked about.
 */
export function useAuthoringGuards(dirty: boolean): {
  readonly release: () => void;
} {
  const held = useRef(dirty);
  useEffect(() => {
    held.current = dirty;
  }, [dirty]);
  useUnloadGuard(dirty);
  useBlocker({
    shouldBlockFn: () =>
      held.current && !window.confirm("Discard the unsaved ticket and leave?"),
    enableBeforeUnload: false,
  });
  return {
    release: () => {
      held.current = false;
    },
  };
}

/** Where one screen's YAML is kept: per project, and per ticket or a new one. */
export function ticketYamlStoreKey(
  partition: PartitionIdentity,
  ticket: number | undefined,
): string {
  return `chug.ticket-yaml.${partition.tenant}/${partition.project}/${ticket === undefined ? "new" : String(ticket)}`;
}

/** Where a new ticket started from another keeps its YAML: per the ticket it
 * started from, apart from both that ticket's edit and a plain new ticket. */
export function ticketYamlDuplicateStoreKey(
  partition: PartitionIdentity,
  from: number,
): string {
  return `chug.ticket-yaml.${partition.tenant}/${partition.project}/duplicate/${String(from)}`;
}

/**
 * Browser storage can throw or come back empty, so a read that fails is a
 * screen with nothing kept, and a write that fails costs the copy and nothing
 * else.
 */
export function ticketYamlStored(key: string): string | undefined {
  try {
    return window.localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

export function ticketYamlKept(key: string, text: string): void {
  try {
    window.localStorage.setItem(key, text);
  } catch {
    /** The text is still on screen; only the copy is lost. */
  }
}

/** Where the images a kept YAML may name are kept: beside it. */
function ticketYamlImagesStoreKey(key: string): string {
  return `${key}.images`;
}

/**
 * The images a screen knew when it kept its YAML. A text names an image by
 * identity and a screen takes only the identities it knows, so the copy is
 * kept beside these: a screen opening on it has attached nothing yet, and
 * would refuse every image it names.
 */
export function ticketYamlImagesStored(key: string): readonly string[] {
  const stored = ticketYamlStored(ticketYamlImagesStoreKey(key));
  if (stored === undefined) return [];
  try {
    const read: unknown = JSON.parse(stored);
    return Array.isArray(read)
      ? read.filter((one): one is string => typeof one === "string")
      : [];
  } catch {
    return [];
  }
}

export function ticketYamlImagesKept(
  key: string,
  images: readonly string[],
): void {
  ticketYamlKept(ticketYamlImagesStoreKey(key), JSON.stringify(images));
}

export function ticketYamlForgotten(key: string): void {
  try {
    window.localStorage.removeItem(key);
    window.localStorage.removeItem(ticketYamlImagesStoreKey(key));
  } catch {
    /** Nothing kept can be read back either. */
  }
}

/** Where the configuration a reader last chose for a new ticket is kept: per
 * project, and for this browser alone. */
function ticketConfigurationStoreKey(partition: PartitionIdentity): string {
  return `chug.ticket-configuration.${partition.tenant}/${partition.project}`;
}

/** The configuration this reader last chose here, kept as the YAML is and as
 * losable. */
export function ticketConfigurationStored(
  partition: PartitionIdentity,
): string | undefined {
  return ticketYamlStored(ticketConfigurationStoreKey(partition));
}

export function ticketConfigurationKept(
  partition: PartitionIdentity,
  name: string,
): void {
  ticketYamlKept(ticketConfigurationStoreKey(partition), name);
}

/**
 * The editor is a separate chunk, so its load is a request that can fail. A
 * failure is not a reason to lose the document: the fallback is drawn in its
 * place and holds the same text.
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
  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
