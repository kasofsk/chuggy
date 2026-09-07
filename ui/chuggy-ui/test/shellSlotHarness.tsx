/**
 * The shell's two slots, provided without the shell's own chrome: a page
 * under test fills them exactly as it fills the real ones, into a sink a
 * query can read. The frame's own show-or-hide behaviour around the details
 * slot is `shell.test.tsx`'s; this only has to exist for a portal to land in.
 */

import type { ReactNode } from "react";

import { ShellSlots, useShellSlotHolder } from "../app/browser/shell/slots.tsx";

export { styleless } from "./styleless.ts";

function ShellSlotSinks(): ReactNode {
  const holdTopBar = useShellSlotHolder("topBar");
  const holdDetails = useShellSlotHolder("details");
  return (
    <>
      <div ref={holdTopBar} />
      <div ref={holdDetails} />
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
