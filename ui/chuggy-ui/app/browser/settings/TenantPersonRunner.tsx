/**
 * Taking one person's own runner off, in their editor, for a reader who
 * administers the workspace. Nobody but its owner reads a runner, so
 * this is offered whether or not the person has one, and the line the press
 * leaves says which it was.
 */

import { useId, useState } from "react";
import type { ReactNode } from "react";

import { apiDeregisterMemberRunner } from "../../core/apiRoutes.ts";
import { memberRunnerRemoved } from "../../core/myRunner.ts";
import { useApiPorts } from "../api.ts";
import { Button } from "../ui/Button.tsx";
import { Confirm } from "../ui/Confirm.tsx";

type TenantPersonRunnerRemoval =
  | { readonly removal: "Idle" }
  | { readonly removal: "Asking" }
  | { readonly removal: "Removing" }
  | { readonly removal: "Answered"; readonly line: string };

export function TenantPersonRunner(props: {
  readonly tenant: string;
  readonly subject: string;
  readonly name: string;
}): ReactNode {
  const ports = useApiPorts();
  const labelled = useId();
  const [removal, setRemoval] = useState<TenantPersonRunnerRemoval>({
    removal: "Idle",
  });
  const remove = (): void => {
    setRemoval({ removal: "Removing" });
    void (async () => {
      const answered = await apiDeregisterMemberRunner(
        ports,
        props.tenant,
        props.subject,
      );
      setRemoval({ removal: "Answered", line: memberRunnerRemoved(answered) });
    })();
  };
  return (
    <div role="group" aria-labelledby={labelled} className="grid gap-2">
      <span id={labelled} className="text-sm text-ink-3">
        Personal runner
      </span>
      {removal.removal === "Asking" || removal.removal === "Removing" ? (
        <Confirm
          question={`Remove ${props.name}'s runner?`}
          confirm="Remove"
          busy={removal.removal === "Removing"}
          onConfirm={remove}
          onCancel={() => {
            setRemoval({ removal: "Idle" });
          }}
        >
          It stops taking their work in this workspace until they register it
          again.
        </Confirm>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="quiet"
            size="sm"
            onClick={() => {
              setRemoval({ removal: "Asking" });
            }}
          >
            Remove runner
          </Button>
          {removal.removal === "Answered" ? (
            <span className="text-sm text-ink-3">{removal.line}</span>
          ) : null}
        </div>
      )}
    </div>
  );
}
