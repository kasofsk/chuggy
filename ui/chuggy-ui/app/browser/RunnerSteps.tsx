/**
 * What a minted registration token is handed over in: the steps that make a
 * machine a runner, each command copied by its own control, for a project's
 * pool and a member's own runner alike.
 */

import { useEffect, useRef } from "react";
import type { ReactNode, RefObject } from "react";

import type { WorkerPoolTokenResponse } from "../../../../src/contract/responses.ts";
import { instantFigure } from "../core/figures.ts";
import { runnerPackages, runnerRegisterCommand } from "../core/runners.ts";
import type { RunnerAsk, RunnerKind } from "../core/runners.ts";
import { useNowMs } from "./Freshness.tsx";
import { currentOrigin } from "./ports.ts";
import { Button } from "./ui/Button.tsx";
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

/** The list takes the focus as it is drawn where nothing holds it. */
export function RunnerSteps(props: {
  readonly minted: WorkerPoolTokenResponse;
  /** What the reader asked, which the register command declares. */
  readonly ask: RunnerAsk;
  readonly kind: RunnerKind;
  readonly onDone: () => void;
}): ReactNode {
  const nowMs = useNowMs();
  const steps = useFocusedUnheld<HTMLOListElement>();
  const offered = runnerPackages[props.ask.package];
  const expires = new Date(props.minted.expiresAtMs).toISOString();
  return (
    <div className="border-edge grid min-w-0 gap-3 border-b pt-3 pb-4">
      <ol
        ref={steps}
        tabIndex={-1}
        aria-label={props.kind === "Pool" ? "Add runner" : "Register runner"}
        className="grid min-w-0 list-decimal gap-3 pl-6"
      >
        <RunnerStep title="Install">
          <CopyBox
            about={offered.needs}
            text={offered.installCommand}
            copyLabel="Copy install command"
          />
        </RunnerStep>
        <RunnerStep title="Register">
          <CopyBox
            about={
              <>
                Expires <Figure figure={instantFigure(expires, nowMs)} />
              </>
            }
            text={runnerRegisterCommand(
              offered,
              currentOrigin(),
              props.minted.token,
              props.kind,
              props.ask,
            )}
            copyLabel="Copy register command"
          />
        </RunnerStep>
        <RunnerStep title="Finish">
          <a
            className="justify-self-start"
            href={offered.guideAddress}
            rel="noopener noreferrer"
            target="_blank"
          >
            Setup guide
          </a>
        </RunnerStep>
      </ol>
      <div className="pl-6">
        <Button size="sm" onClick={props.onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
