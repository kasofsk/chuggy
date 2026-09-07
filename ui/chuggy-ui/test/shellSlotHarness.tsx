/**
 * The shell's three slots, provided without the shell's own chrome: a page
 * under test fills them exactly as it fills the real ones, into a sink a
 * query can read. The frame's own show-or-hide behaviour around the details
 * slot is `shell.test.tsx`'s; this only has to exist for a portal to land in.
 */

import { expect } from "vitest";
import type { ReactNode } from "react";

import { ShellSlots, useShellSlotHolder } from "../app/browser/shell/slots.tsx";

/** The served policy refuses a runtime `<style>` element, so a case checks
 * this after mounting and after each interaction rather than trusting it
 * from the primitives a page composes. */
export function styleless(): void {
  expect(document.querySelectorAll("style")).toHaveLength(0);
}

function ShellSlotSinks(): ReactNode {
  const holdTopBar = useShellSlotHolder("topBar");
  const holdDetails = useShellSlotHolder("details");
  const holdBottom = useShellSlotHolder("bottom");
  return (
    <>
      <div ref={holdTopBar} />
      <div ref={holdDetails} />
      <div ref={holdBottom} />
    </>
  );
}

export function ShellSlotHarness(props: {
  readonly children: ReactNode;
}): ReactNode {
  return (
    <ShellSlots>
      <ShellSlotSinks />
      {props.children}
    </ShellSlots>
  );
}
