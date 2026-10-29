/**
 * Why the worker app cannot be said to reach a bound repository, on that
 * binding's row: the word, why on hover, and the installation's own page on
 * the forge where an owner changes what it selects.
 */

import type { ReactNode } from "react";

import type { ProjectRepositoryWorkerReachResponse } from "../../../../../src/contract/responses.ts";
import { repositoryWorkerReachLine } from "../../core/projectRepositories.ts";
import { repositoryWorkerReachTone } from "../../core/tones.ts";
import { buttonLookClassName } from "../ui/Button.tsx";
import { Pill } from "../ui/Pill.tsx";
import { Tooltip } from "../ui/Tooltip.tsx";

export function BindingWorkerReach(props: {
  readonly reach: ProjectRepositoryWorkerReachResponse;
}): ReactNode {
  const line = repositoryWorkerReachLine(props.reach);
  return (
    <>
      <Tooltip text={line.detail}>
        <span>
          <Pill tone={repositoryWorkerReachTone(props.reach.reach)}>
            {line.status}
          </Pill>
        </span>
      </Tooltip>
      {line.settingsUrl === undefined ? null : (
        <a
          href={line.settingsUrl}
          className={buttonLookClassName({ size: "sm" })}
          rel="noopener noreferrer"
          target="_blank"
        >
          Review on GitHub
        </a>
      )}
    </>
  );
}
