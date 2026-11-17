/**
 * Why the worker app cannot be said to reach a bound repository, on that
 * binding's row: the word, why after it, and the installation's own page on
 * the forge where an owner changes what it selects.
 */

import type { ReactNode } from "react";

import type { ProjectRepositoryWorkerReachResponse } from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { repositoryWorkerReachLine } from "../../core/projectRepositories.ts";
import { repositoryWorkerReachTone } from "../../core/tones.ts";
import { buttonLookClassName } from "../ui/Button.tsx";
import { StatusBadge } from "../ui/StatusBadge.tsx";
import { WordDetail } from "../ui/WordDetail.tsx";

export function BindingWorkerReach(props: {
  readonly reach: ProjectRepositoryWorkerReachResponse;
}): ReactNode {
  const text = useCopyText();
  const line = repositoryWorkerReachLine(props.reach);
  return (
    <>
      <span>
        <WordDetail
          word={
            <StatusBadge
              tone={repositoryWorkerReachTone(props.reach.reach)}
              size="small"
            >
              {text(line.status)}
            </StatusBadge>
          }
          detail={line.detail}
        />
      </span>
      {line.settingsUrl === undefined ? null : (
        <a
          href={line.settingsUrl}
          className={buttonLookClassName({ size: "sm" })}
          rel="noopener noreferrer"
          target="_blank"
        >
          {text({ id: "repositories-reach-review" })}
        </a>
      )}
    </>
  );
}
