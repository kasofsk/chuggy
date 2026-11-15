/**
 * Making a project: the workspace it belongs to, its own name, and one submit,
 * on the landing a reader with no project meets and at its own address, where
 * the address may name the workspace the form starts on. The workspace is a
 * choice among the ones the reader may add a project to, and a typed name's
 * rule stands under its field before anything is typed. Both are asked on the
 * first screen because the wire takes nothing else.
 *
 * A refusal about one of the names is drawn under that name's field, and the
 * focus moves there once for it; any other is drawn beside the submit, which
 * says the project is being made while it is.
 *
 * Over the form stands the line a reader pastes into Claude Code to have this
 * site's setup program run in their repository, in a box with the control that
 * copies it. It is built from the console's own address alone, so it is drawn
 * before either read has answered and does not move when one does.
 *
 * A reader with nothing to choose is drawn an empty state where the form
 * would be, and neither the line nor what its page leads the form with is
 * drawn over it.
 *
 * The last press's operation identity belongs to the two names it sent. A
 * press while the form holds those two repeats that creation, as after an
 * answer that never arrived, and any other two go under an identity of their
 * own.
 */

import { useNavigate } from "@tanstack/react-router";
import type { UseNavigateResult } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

import type { ProjectCreatedResponse } from "../../../../src/contract/responses.ts";
import { useCopyText } from "../copy/CopyProvider.tsx";
import { apiCreateProject } from "../core/apiRoutes.ts";
import { base64urlFromBytes } from "../core/base64url.ts";
import {
  claudeCodeLine,
  claudeCodeLineAbout,
  claudeCodeLineCopy,
} from "../core/claudeCodeLine.ts";
import { consoleWriteKey } from "../core/consoleWrite.ts";
import type {
  ConsoleWrite,
  ConsoleWriteRefused,
} from "../core/consoleWrite.ts";
import { lastProjectWrite } from "../core/lastProject.ts";
import { operationIdBytesCount } from "../core/operationFollow.ts";
import {
  projectCreationNameFault,
  projectCreationRefusalLabel,
  projectCreationSendable,
  projectCreationStanding,
  projectNameRule,
} from "../core/projectCreation.ts";
import type {
  ProjectCreationForm as ProjectCreationFields,
  ProjectCreationSent,
} from "../core/projectCreation.ts";
import { projectCreationRefusalField } from "../core/projectCreationRefusalField.ts";
import type { ProjectCreationField } from "../core/projectCreationRefusalField.ts";
import {
  projectCreationWorkspaceChosen,
  projectCreationWorkspaceEntryText,
  projectCreationWorkspaceNamed,
  projectCreationWorkspaceOffer,
  projectCreationWorkspacePicked,
  projectCreationWorkspaceTenant,
} from "../core/projectCreationWorkspace.ts";
import type {
  ProjectCreationWorkspaceDrawn,
  ProjectCreationWorkspaceOffer,
  ProjectCreationWorkspaceSaid,
} from "../core/projectCreationWorkspace.ts";
import {
  callerSiteAbilitiesQuery,
  callerTenantsQuery,
  projectsInventoryQuery,
} from "../core/tenantQueries.ts";
import { usePanelState } from "./api.ts";
import { useConsoleWrite } from "./consoleWrite.tsx";
import { copyOrDataText } from "../core/copy.ts";
import type { Copy, CopyText } from "../core/copy.ts";
import { settingsRoutes } from "../core/settingsNav.ts";
import { PanelUnready } from "./DataPanel.tsx";
import { Footer } from "./Footer.tsx";
import {
  clipboardWritten,
  currentOrigin,
  drawBytes,
  persistentStore,
} from "./ports.ts";
import { TopBar } from "./shell/TopBar.tsx";
import { Button } from "./ui/Button.tsx";
import { CopyBox } from "./ui/CopyBox.tsx";
import { CopyProvider } from "./ui/copyHeld.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { FormField } from "./ui/FormField.tsx";
import { Input } from "./ui/Input.tsx";
import { Notice } from "./ui/Notice.tsx";
import { PageHeader } from "./ui/PageHeader.tsx";
import { Picker } from "./ui/Picker.tsx";

function drawnOperation(): string {
  return base64urlFromBytes(drawBytes(operationIdBytesCount));
}

interface ProjectCreationNameProps {
  readonly field: ProjectCreationField;
  readonly label: string;
  readonly hint: Copy;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** The line a refusal of this name left, drawn while the name holds no
   * fault of its own. */
  readonly refused: string | undefined;
}

/** A name's field: its hint under it, or the name's fault against the rule,
 * or the refusal the name was answered with. */
function ProjectCreationName(props: ProjectCreationNameProps): ReactNode {
  const text = useCopyText();
  const fault = projectCreationNameFault(props.value);
  const error = fault === undefined ? props.refused : text(fault);
  return (
    <div data-project-creation-field={props.field}>
      <Input
        labelShown
        required
        label={props.label}
        value={props.value}
        onChange={props.onChange}
        {...(error === undefined ? { hint: text(props.hint) } : { error })}
      />
    </div>
  );
}

interface ProjectCreationWorkspaceProps {
  readonly said: ProjectCreationWorkspaceSaid;
  readonly onSay: (said: ProjectCreationWorkspaceSaid) => void;
  readonly refused: string | undefined;
}

/** The choice, its entries told apart by their place in it because a
 * workspace may be called what another entry is, and the name field under it
 * while the making of a workspace is chosen, which is then what a refusal of
 * the workspace is drawn under. With no entry chosen it asks. */
function ProjectCreationWorkspaceChoice(
  props: ProjectCreationWorkspaceProps & {
    readonly offer: Extract<
      ProjectCreationWorkspaceOffer,
      { readonly offer: "Choice" }
    >;
  },
): ReactNode {
  const text = useCopyText();
  const { offer, said, onSay } = props;
  const chosen = projectCreationWorkspaceChosen(offer, said);
  const making = chosen?.entry === "New";
  const workspaceLabel = text({ id: "project-creation-workspace-label" });
  return (
    <>
      <div data-project-creation-field={making ? undefined : "tenant"}>
        <FormField
          label={workspaceLabel}
          required
          {...(making || props.refused === undefined
            ? {}
            : { error: props.refused })}
        >
          {(field) => (
            <Picker
              label={workspaceLabel}
              field={field}
              align="start"
              value={
                chosen === undefined
                  ? ""
                  : String(offer.entries.indexOf(chosen))
              }
              placeholder={text({ id: "project-creation-workspace-choose" })}
              options={offer.entries.map((entry, at) => ({
                value: String(at),
                text: copyOrDataText(
                  text,
                  projectCreationWorkspaceEntryText(entry),
                ),
              }))}
              onChoose={(at) => {
                const picked = offer.entries[Number(at)];
                if (picked !== undefined)
                  onSay(projectCreationWorkspacePicked(offer, said, picked));
              }}
            />
          )}
        </FormField>
      </div>
      {making ? (
        <ProjectCreationName
          field="tenant"
          label={text({ id: "project-creation-workspace-name-label" })}
          hint={projectNameRule}
          value={projectCreationWorkspaceTenant(offer, said)}
          onChange={(name) => {
            onSay(projectCreationWorkspaceNamed(offer, name));
          }}
          refused={props.refused}
        />
      ) : null}
    </>
  );
}

function ProjectCreationWorkspace(
  props: ProjectCreationWorkspaceProps & {
    readonly offer: ProjectCreationWorkspaceDrawn;
  },
): ReactNode {
  const text = useCopyText();
  const { offer, said, onSay } = props;
  const workspaceLabel = text({ id: "project-creation-workspace-label" });
  switch (offer.offer) {
    case "Pending":
      return (
        <div className="form-field">
          <span className="form-field-label">{workspaceLabel}</span>
          <PanelUnready state={{ state: "Pending" }} />
        </div>
      );
    case "Typed":
      return (
        <ProjectCreationName
          field="tenant"
          label={workspaceLabel}
          hint={projectNameRule}
          value={projectCreationWorkspaceTenant(offer, said)}
          onChange={(name) => {
            onSay(projectCreationWorkspaceNamed(offer, name));
          }}
          refused={props.refused}
        />
      );
    case "Choice":
      return <ProjectCreationWorkspaceChoice {...props} offer={offer} />;
  }
}

/** One creation under the identity its press drew or repeated, over once the
 * projects inventory has been read again with it, and then the new project's
 * repositories, whether or not the form is still drawn. */
function projectCreationWrite(
  navigate: UseNavigateResult<string>,
  text: CopyText,
): ConsoleWrite<ProjectCreationSent, ProjectCreatedResponse> {
  return {
    mutationKey: consoleWriteKey("project-creation"),
    write: (ports, sent) =>
      apiCreateProject(ports, sent.fields, sent.operation),
    refusal: (failure) => text(projectCreationRefusalLabel(failure)),
    landed: async (client, partition) => {
      lastProjectWrite(persistentStore, partition);
      await client.invalidateQueries({
        queryKey: projectsInventoryQuery().queryKey,
      });
      void navigate({
        to: settingsRoutes.project.repositories,
        params: partition,
      });
    },
  };
}

/** What a refusal of the names the form holds left: the line it is drawn
 * as, and the field it is drawn under, none where it is about neither. */
interface ProjectCreationRefusal {
  readonly refused: ConsoleWriteRefused;
  readonly field: ProjectCreationField | undefined;
}

/** The press that sends these two names, and the refusal of them, which is
 * drawn only while the form holds the names it answered. */
function useProjectCreationSend(fields: ProjectCreationFields): {
  readonly busy: boolean;
  readonly refusal: ProjectCreationRefusal | undefined;
  readonly create: () => void;
} {
  const navigate = useNavigate();
  const text = useCopyText();
  const creating = useConsoleWrite(projectCreationWrite(navigate, text), {
    drawn: (_, sent) => projectCreationStanding(sent, fields) !== undefined,
  });
  const standing = projectCreationStanding(creating.variables, fields);
  const create = (): void => {
    const operation = standing?.operation ?? drawnOperation();
    creating.mutate({ fields, operation });
  };
  const refused = standing === undefined ? null : creating.error;
  return {
    busy: creating.isPending,
    refusal:
      refused === null
        ? undefined
        : { refused, field: projectCreationRefusalField(refused.failure) },
    create,
  };
}

const projectCreationFocusable = [
  "input:not(:disabled)",
  "button:not(:disabled)",
].join(",");

/** On each refusal about a field, and only once for it, the focus on that
 * field's control. */
function useProjectCreationRefusalFocus(
  root: RefObject<HTMLElement | null>,
  refusal: ProjectCreationRefusal | undefined,
): void {
  const answered = useRef<ConsoleWriteRefused>(undefined);
  useEffect(() => {
    if (refusal === undefined || answered.current === refusal.refused) return;
    answered.current = refusal.refused;
    if (refusal.field === undefined) return;
    root.current
      ?.querySelector(`[data-project-creation-field="${refusal.field}"]`)
      ?.querySelector<HTMLElement>(projectCreationFocusable)
      ?.focus();
  }, [root, refusal]);
}

/** The line beside the submit: that the project is being made, or a refusal
 * about neither name. */
function projectCreationStatusLine(
  busy: boolean,
  refusal: ProjectCreationRefusal | undefined,
  text: CopyText,
): string | undefined {
  if (busy) return text({ id: "project-creation-creating" });
  return refusal?.field === undefined ? refusal?.refused.message : undefined;
}

function ProjectCreationForm(props: {
  readonly offer: ProjectCreationWorkspaceDrawn;
}): ReactNode {
  const root = useRef<HTMLDivElement>(null);
  const [workspace, setWorkspace] =
    useState<ProjectCreationWorkspaceSaid>(undefined);
  const [project, setProject] = useState("");
  const fields: ProjectCreationFields = {
    tenant: projectCreationWorkspaceTenant(props.offer, workspace),
    project,
  };
  const send = useProjectCreationSend(fields);
  useProjectCreationRefusalFocus(root, send.refusal);
  const text = useCopyText();
  const refusedAt = (field: ProjectCreationField): string | undefined =>
    send.refusal?.field === field ? send.refusal.refused.message : undefined;
  const status = projectCreationStatusLine(send.busy, send.refusal, text);
  return (
    <div className="grid w-full max-w-aside gap-3" ref={root}>
      <ProjectCreationWorkspace
        offer={props.offer}
        said={workspace}
        onSay={setWorkspace}
        refused={refusedAt("tenant")}
      />
      <ProjectCreationName
        field="project"
        label={text({ id: "project-creation-project-label" })}
        hint={{ id: "project-creation-project-hint" }}
        value={project}
        onChange={setProject}
        refused={refusedAt("project")}
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          variant="primary"
          disabled={!projectCreationSendable(fields) || send.busy}
          busy={send.busy}
          onClick={send.create}
        >
          {text({ id: "project-creation-submit" })}
        </Button>
        {status === undefined ? null : (
          <Notice tone="info" inline role="status" detail={status} />
        )}
      </div>
    </div>
  );
}

/** The line for this console's own site, as wide as the form it stands over. */
function ProjectCreationClaudeCode(): ReactNode {
  const text = useCopyText();
  return (
    <div className="w-full max-w-aside">
      <CopyBox
        about={text(claudeCodeLineAbout)}
        text={claudeCodeLine(currentOrigin())}
        copyLabel={text(claudeCodeLineCopy)}
        breaks="words"
      />
    </div>
  );
}

/**
 * The line and the form under what their page leads them with, the form
 * starting on the workspace it is given, or the empty state that stands in
 * for all of it.
 */
export function ProjectCreation(props: {
  readonly workspace?: string | undefined;
  readonly lead?: ReactNode;
}): ReactNode {
  const text = useCopyText();
  const offer = projectCreationWorkspaceOffer(
    usePanelState(callerTenantsQuery()),
    usePanelState(callerSiteAbilitiesQuery()),
    props.workspace,
  );
  if (offer.offer === "Withheld")
    return (
      <EmptyState
        variant="page"
        level={1}
        label={text(offer.label)}
        detail={text(offer.detail)}
      />
    );
  return (
    <>
      {props.lead}
      <ProjectCreationClaudeCode />
      <ProjectCreationForm offer={offer} />
    </>
  );
}

/** A screen outside every project: the bar, the page under it, and the footer
 * at the foot of the viewport, with the clipboard a copy control under it asks for. */
export function ProjectlessFrame(props: {
  readonly children: ReactNode;
}): ReactNode {
  return (
    <CopyProvider write={clipboardWritten}>
      <div className="grid min-h-dvh grid-rows-[auto_minmax(0,1fr)_auto]">
        <TopBar partition={undefined} />
        <main className="grid content-start gap-4 p-4">{props.children}</main>
        <div className="px-4 pb-4">
          <Footer />
        </div>
      </div>
    </CopyProvider>
  );
}

export function ProjectCreationPage(props: {
  readonly workspace?: string | undefined;
}): ReactNode {
  const text = useCopyText();
  return (
    <ProjectlessFrame>
      <ProjectCreation
        workspace={props.workspace}
        lead={
          <div className="w-full max-w-aside">
            <PageHeader title={text({ id: "project-creation-new-title" })} />
          </div>
        }
      />
    </ProjectlessFrame>
  );
}
