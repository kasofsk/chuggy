/**
 * Taking every one of a person's own runners off, in their editor, for a
 * reader who administers the workspace. Nobody but their owner reads them, so
 * this is offered whether or not the person has any, and the line the press
 * leaves says which it was.
 */

import { useId, useState } from "react";
import type { ReactNode } from "react";

import { useCopyText } from "../../copy/CopyProvider.tsx";
import { apiDeregisterMemberRunner } from "../../core/apiRoutes.ts";
import { copyOrDataText } from "../../core/copy.ts";
import type { CopyText } from "../../core/copy.ts";
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type { ConsoleWrite } from "../../core/consoleWrite.ts";
import { memberRunnerRemoved } from "../../core/myRunner.ts";
import { ConsoleWriteRefusedWords, useConsoleWrite } from "../consoleWrite.tsx";
import { Button } from "../ui/Button.tsx";
import { Confirm } from "../ui/Confirm.tsx";

/** Every runner of the person's taken off, which nothing this reader reads
 * draws. */
function tenantPersonRunnerRemovalWrite(
  tenant: string,
  subject: string,
  text: CopyText,
): ConsoleWrite<undefined, undefined> {
  return {
    mutationKey: consoleWriteKey("member-runner-removal", tenant, subject),
    write: (ports) => apiDeregisterMemberRunner(ports, tenant, subject),
    refusal: (failure) => copyOrDataText(text, memberRunnerRemoved(failure)),
  };
}

export function TenantPersonRunner(props: {
  readonly tenant: string;
  readonly subject: string;
  readonly name: string;
}): ReactNode {
  const text = useCopyText();
  const labelled = useId();
  const [asking, setAsking] = useState(false);
  const removing = useConsoleWrite(
    tenantPersonRunnerRemovalWrite(props.tenant, props.subject, text),
    { drawn: true },
  );
  const line =
    removing.error === null ? (
      removing.isSuccess ? (
        copyOrDataText(
          text,
          memberRunnerRemoved({ outcome: "Ok", value: undefined }),
        )
      ) : undefined
    ) : (
      <ConsoleWriteRefusedWords refused={removing.error} />
    );
  return (
    <div role="group" aria-labelledby={labelled} className="grid gap-2">
      <span id={labelled} className="text-sm text-ink-3">
        {text({ id: "runners-member-label" })}
      </span>
      {asking || removing.isPending ? (
        <Confirm
          question={text({
            id: "runners-member-question",
            args: { name: props.name },
          })}
          confirm={text({ id: "runners-member-confirm" })}
          busy={removing.isPending}
          onConfirm={() => {
            removing.mutate(undefined, {
              onSettled: () => {
                setAsking(false);
              },
            });
          }}
          onCancel={() => {
            setAsking(false);
          }}
        >
          {text({ id: "runners-member-line" })}
        </Confirm>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="quiet"
            size="sm"
            onClick={() => {
              removing.reset();
              setAsking(true);
            }}
          >
            {text({ id: "runners-member-remove" })}
          </Button>
          {line === undefined ? null : (
            <span className="text-sm text-ink-3">{line}</span>
          )}
        </div>
      )}
    </div>
  );
}
