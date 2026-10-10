/**
 * The command a minted registration token is handed over in, copied whole by
 * one press, for a project's pool and a member's own runner alike.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { WorkerPoolTokenResponse } from "../../../../src/contract/responses.ts";
import { instantFigure } from "../core/figures.ts";
import { runnerRegisterCommand } from "../core/runners.ts";
import type { RunnerKind } from "../core/runners.ts";
import { useNowMs } from "./Freshness.tsx";
import { clipboardWritten, currentOrigin } from "./ports.ts";
import { Button } from "./ui/Button.tsx";
import { Figure } from "./ui/Figure.tsx";
import { Notice } from "./ui/Notice.tsx";

export function RunnerCommand(props: {
  readonly minted: WorkerPoolTokenResponse;
  readonly kind: RunnerKind;
  readonly onDone: () => void;
}): ReactNode {
  const nowMs = useNowMs();
  const [copied, setCopied] = useState<boolean | undefined>(undefined);
  const command = runnerRegisterCommand(
    currentOrigin(),
    props.minted.token,
    props.kind,
  );
  return (
    <div className="grid gap-2">
      <span className="text-sm text-ink-3">Run on the machine</span>
      <code
        aria-label="Command"
        className="bg-surface-2 rounded-2 px-2 py-1 font-mono text-sm text-ink-1 break-all"
      >
        {command}
      </code>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            void clipboardWritten(command).then(setCopied);
          }}
        >
          {copied === true ? "Copied" : "Copy"}
        </Button>
        <Button variant="quiet" size="sm" onClick={props.onDone}>
          Done
        </Button>
        <span className="text-sm text-ink-3">
          Expires{" "}
          <Figure
            figure={instantFigure(
              new Date(props.minted.expiresAtMs).toISOString(),
              nowMs,
            )}
          />
        </span>
        {copied === false ? (
          <Notice tone="parked" inline detail="Copy blocked" />
        ) : null}
      </div>
    </div>
  );
}
