/**
 * Where a member registers a machine of theirs, a runner or their chat host:
 * the line to paste into their coding agent first, which has the setup
 * program mint the token and register the machine itself, and registering it
 * by hand folded under it. Where there is no line, the fold stands open.
 */

import { useState } from "react";
import type { ReactElement, ReactNode } from "react";

import { useCopyText } from "../copy/CopyProvider.tsx";
import {
  claudeCodeLineCopy,
  claudeCodeRegisterLineAbout,
} from "../core/claudeCodeLine.ts";
import { useFocusedUnheld } from "./RunnerSteps.tsx";
import { Button } from "./ui/Button.tsx";
import { CopyBox } from "./ui/CopyBox.tsx";
import { Disclosure } from "./ui/Disclosure.tsx";

/** The line a register panel leads with. */
function RunnerRegisterLine(props: { readonly line: string }): ReactNode {
  const text = useCopyText();
  return (
    <div className="w-full max-w-aside">
      <CopyBox
        about={text(claudeCodeRegisterLineAbout)}
        text={props.line}
        copyLabel={text(claudeCodeLineCopy)}
        breaks="words"
      />
    </div>
  );
}

/** The panel, named `label`, which takes the focus as it is drawn where nothing holds it. */
export function RunnerRegister(props: {
  readonly label: string;
  /** What the panel says before the line: a choice the line is made from, or what registering replaces. */
  readonly lead?: ReactNode;
  readonly line: string | undefined;
  readonly byHand: ReactElement;
  readonly onDone: () => void;
}): ReactNode {
  const text = useCopyText();
  const [open, setOpen] = useState(props.line === undefined);
  const panel = useFocusedUnheld<HTMLDivElement>();
  return (
    <div
      ref={panel}
      tabIndex={-1}
      role="group"
      aria-label={props.label}
      className="runner-mint border-edge grid min-w-0 justify-items-start gap-3 border-b pt-3 pb-4"
    >
      {props.lead}
      {props.line === undefined ? null : (
        <RunnerRegisterLine line={props.line} />
      )}
      <Disclosure
        open={open}
        onOpenChange={setOpen}
        label={text({ id: "runners-register-by-hand" })}
        look={{ variant: "quiet", size: "sm" }}
        chevron
      >
        <div className="grid w-full min-w-0 gap-3">{props.byHand}</div>
      </Disclosure>
      <Button size="sm" onClick={props.onDone}>
        {text({ id: "runners-done" })}
      </Button>
    </div>
  );
}
