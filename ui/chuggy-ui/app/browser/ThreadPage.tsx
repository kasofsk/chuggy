/**
 * One thread's own page: its head, and its conversation filling the page
 * under it as a column to read.
 *
 * The frame draws no chat pane here, so a thread of the reader's own is never
 * drawn twice with two composers. Whose thread it is, is the read's own
 * `mine`, so another member's is drawn with no composer, and the line in its
 * place says so with the way back to its project, as a thread that takes no
 * more messages says its standing. Its head's Context opens what the thread's
 * model holds beside the conversation.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { useCopyText } from "../copy/CopyProvider.tsx";
import { projectAbilityRefused } from "../core/projectAbilities.ts";
import { navRoutes } from "../core/shellNav.ts";
import { threadHomeOf } from "../core/threadHome.ts";
import { PanelUnready } from "./DataPanel.tsx";
import { useProjectAbilities } from "./projectAbilities.tsx";
import { useProjectNamed } from "./projectNamed.ts";
import { ThreadConversation } from "./thread/ThreadConversation.tsx";
import { ThreadPageDrawn } from "./thread/ThreadPageDrawn.tsx";
import { useThread } from "./thread/threadRead.ts";
import { PageHeader } from "./ui/PageHeader.tsx";

import "./shell/shell.css";

/** The project, linked, worded by `id` with its name. */
function ThreadPageProjectLink(props: {
  readonly partition: PartitionIdentity;
  readonly id: "chat-page-project" | "chat-page-back";
}): ReactNode {
  const text = useCopyText();
  const named = useProjectNamed();
  return (
    <Link to={navRoutes.overview} params={props.partition}>
      {text({
        id: props.id,
        args: { project: named(props.partition) },
      })}
    </Link>
  );
}

export function ThreadPage(props: {
  readonly partition: PartitionIdentity;
  readonly session: string;
}): ReactNode {
  const text = useCopyText();
  const state = useThread(props.partition, props.session);
  const viewOnly = projectAbilityRefused(
    useProjectAbilities(props.partition),
    "mutate",
  );
  if (state.state !== "Ready")
    return (
      <div className="chat-page-head">
        <PageHeader title={text({ id: "chat-heading" })} />
        <PanelUnready state={state} />
      </div>
    );
  return (
    <ThreadPageDrawn
      home={threadHomeOf(props.partition)}
      thread={state.value}
      viewOnly={viewOnly}
      meta={
        <ThreadPageProjectLink
          partition={props.partition}
          id="chat-page-project"
        />
      }
      forward={
        <ThreadPageProjectLink
          partition={props.partition}
          id="chat-page-back"
        />
      }
      conversation={(drawn) => (
        <ThreadConversation
          partition={props.partition}
          thread={state.value}
          unavailable={drawn.unavailable}
          beside={drawn.beside}
        />
      )}
    />
  );
}
