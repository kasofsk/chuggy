/**
 * The project the bar is showing, every other project this reader may read,
 * and the way to make another. That names the workspace of the one shown to
 * the form that makes it, whose choice starts there only where the reader
 * administers that workspace.
 *
 * A pick is a navigation, and the picked project is remembered so the next tab
 * opens where this one left off. An inventory that has not answered says so
 * rather than offering an empty list.
 *
 * NO PROJECT IS A CHOICE IN THE WORKSPACE SHOWN, where it lets the reader chat
 * outside a project, and picking it opens their own chat there.
 */

import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { CopyText } from "../../core/copy.ts";
import { projectsInventoryQuery } from "../../core/tenantQueries.ts";
import { lastProjectWrite } from "../../core/lastProject.ts";
import { memberChatOpens, memberChatRoutes } from "../../core/memberChat.ts";
import { projectCreationRoutePath } from "../../core/projectCreation.ts";
import { usePanelState } from "../api.ts";
import { persistentStore } from "../ports.ts";
import { useChatAbilities } from "../thread/threadRead.ts";
import { Notice } from "../ui/Notice.tsx";
import { Picker } from "../ui/Picker.tsx";

/** A folder, which is what a project is on a bar too narrow for its name. */
const projectGlyph = (
  <svg
    aria-hidden="true"
    className="size-4 shrink-0"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.8l1.4 1.5h4.8A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />
  </svg>
);

/** The value the picker names a workspace's own chat by, which no project's
 * value is, since a project's name is never empty. */
function projectSwitcherNone(tenant: string): string {
  return `${tenant}/`;
}

export function ProjectSwitcher(props: {
  readonly partition: PartitionIdentity | undefined;
  /** The tenant whose own chat the page is, where it is one. */
  readonly chat?: string;
}): ReactNode {
  const tenant = props.partition?.tenant ?? props.chat;
  return tenant === undefined ? (
    <ProjectSwitcherPicker {...props} chats={false} />
  ) : (
    <ProjectSwitcherAt {...props} tenant={tenant} />
  );
}

/** The switcher in a workspace, offering its own chat where it may be had. */
function ProjectSwitcherAt(props: {
  readonly partition: PartitionIdentity | undefined;
  readonly chat?: string;
  readonly tenant: string;
}): ReactNode {
  const abilities = useChatAbilities(props.tenant);
  return (
    <ProjectSwitcherPicker
      {...props}
      chats={memberChatOpens(
        abilities.state === "Ready" ? abilities.value : undefined,
      )}
    />
  );
}

/** The project's whole name, which is what the trigger says where it is a folder. */
function projectSwitcherHint(
  partition: PartitionIdentity | undefined,
): string | undefined {
  return partition === undefined
    ? undefined
    : `${partition.tenant} / ${partition.project}`;
}

/** The workspace's own chat, as the picker offers it where it may be had. */
function projectSwitcherChat(
  tenant: string | undefined,
  chats: boolean,
  text: CopyText,
): readonly { readonly value: string; readonly text: string }[] {
  return tenant === undefined || !chats
    ? []
    : [
        {
          value: projectSwitcherNone(tenant),
          text: `${tenant} / ${text({ id: "shell-project-none" })}`,
        },
      ];
}

function ProjectSwitcherPicker(props: {
  readonly partition: PartitionIdentity | undefined;
  readonly chat?: string;
  readonly tenant?: string;
  /** Whether the workspace shown lets the reader chat outside a project. */
  readonly chats: boolean;
}): ReactNode {
  const navigate = useNavigate();
  const text = useCopyText();
  const state = usePanelState(projectsInventoryQuery());
  if (state.state !== "Ready")
    return (
      <Notice
        tone="parked"
        inline
        detail={text({ id: "shell-projects-unavailable" })}
      />
    );
  const { tenant } = props;
  const none = projectSwitcherChat(tenant, props.chats, text);
  return (
    <Picker
      label={text({ id: "shell-project" })}
      glyph={projectGlyph}
      hint={projectSwitcherHint(props.partition)}
      value={
        props.partition !== undefined
          ? `${props.partition.tenant}/${props.partition.project}`
          : props.chat !== undefined && props.chats
            ? projectSwitcherNone(props.chat)
            : ""
      }
      placeholder={text({ id: "shell-project" })}
      options={[
        ...none,
        ...state.value.map((candidate) => ({
          value: `${candidate.tenant}/${candidate.project}`,
          text: `${candidate.tenant} / ${candidate.project}`,
        })),
      ]}
      onChoose={(picked) => {
        if (tenant !== undefined && picked === projectSwitcherNone(tenant)) {
          void navigate({ to: memberChatRoutes.chat, params: { tenant } });
          return;
        }
        const chosen = state.value.find(
          (candidate) => `${candidate.tenant}/${candidate.project}` === picked,
        );
        if (chosen === undefined) return;
        lastProjectWrite(persistentStore, chosen);
        void navigate({
          to: "/$tenant/$project",
          params: { tenant: chosen.tenant, project: chosen.project },
        });
      }}
      actions={[
        {
          text: text({ id: "shell-project-new" }),
          onSelect: () => {
            void navigate({
              to: projectCreationRoutePath,
              search: { workspace: tenant },
            });
          },
        },
      ]}
    />
  );
}
