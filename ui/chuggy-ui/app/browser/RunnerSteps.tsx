/**
 * What a minted registration token is handed over in: the steps that make a
 * machine a runner, install and register, each command copied by its own
 * control, for a member's own runner and their chat host alike.
 */

import { useEffect, useRef } from "react";
import type { ReactNode, RefObject } from "react";

import type { WorkerPoolTokenResponse } from "../../../../src/contract/responses.ts";
import { useCopyText } from "../copy/CopyProvider.tsx";
import { instantFigure } from "../core/figures.ts";
import type { Copy } from "../core/copy.ts";
import { runnerPackages, runnerRegisterCommand } from "../core/runners.ts";
import type { RunnerAsk, RunnerKind } from "../core/runners.ts";
import { useNowMs } from "./Freshness.tsx";
import { currentOrigin } from "./ports.ts";
import { CopyBox } from "./ui/CopyBox.tsx";
import { Figure } from "./ui/Figure.tsx";

function RunnerStep(props: {
  readonly title: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <li className="marker:text-ink-3">
      <div className="grid min-w-0 gap-2">
        <span className="font-medium text-ink-1">{props.title}</span>
        {props.children}
      </div>
    </li>
  );
}

/**
 * An element that takes the focus as it is drawn only where nothing holds it,
 * which is where a press leaves it once the control is disabled or gone, so a
 * reader who has since moved on keeps their place.
 */
export function useFocusedUnheld<
  Drawn extends HTMLElement,
>(): RefObject<Drawn | null> {
  const drawn = useRef<Drawn>(null);
  useEffect(() => {
    const element = drawn.current;
    if (element === null) return;
    const held = element.ownerDocument.activeElement;
    if (held === null || held === element.ownerDocument.body) element.focus();
  }, []);
  return drawn;
}

/** What the console registers a machine as: a pool is registered from its own machine alone. */
export type RunnerStepsKind = Exclude<RunnerKind, "Pool">;

/** What the steps' list is called for a machine registered as `kind`. */
function runnerStepsLabel(kind: RunnerStepsKind): Copy {
  switch (kind) {
    case "Personal":
      return { id: "runners-register" };
    case "ChatHost":
      return { id: "runners-chat-host-register" };
  }
}

/** The list takes the focus as it is drawn where nothing holds it. */
export function RunnerSteps(props: {
  readonly minted: WorkerPoolTokenResponse;
  /** What the reader asked, which the register command declares. */
  readonly ask: RunnerAsk;
  readonly kind: RunnerStepsKind;
}): ReactNode {
  const text = useCopyText();
  const nowMs = useNowMs();
  const steps = useFocusedUnheld<HTMLOListElement>();
  const offered = runnerPackages[props.ask.package];
  const expires = new Date(props.minted.expiresAtMs).toISOString();
  return (
    <ol
      ref={steps}
      tabIndex={-1}
      aria-label={text(runnerStepsLabel(props.kind))}
      className="grid min-w-0 list-decimal gap-3 pl-6"
    >
      <RunnerStep title={text({ id: "runners-steps-install" })}>
        <CopyBox
          about={text(offered.needs)}
          text={offered.installCommand}
          copyLabel={text({ id: "runners-steps-copy-install" })}
        />
      </RunnerStep>
      <RunnerStep title={text({ id: "runners-steps-register" })}>
        <CopyBox
          about={
            <>
              {text({ id: "runners-steps-expires" })}{" "}
              <Figure figure={instantFigure(expires, nowMs)} />
            </>
          }
          text={runnerRegisterCommand(
            offered,
            currentOrigin(),
            props.minted.token,
            props.kind,
            props.ask,
          )}
          copyLabel={text({ id: "runners-steps-copy-register" })}
        />
      </RunnerStep>
    </ol>
  );
}
