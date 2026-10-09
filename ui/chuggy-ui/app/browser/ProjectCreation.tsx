/**
 * Making a project: the workspace it belongs to, its own name, and one submit,
 * on the landing a reader with no project meets and at its own address, where
 * the address may name the workspace the form starts on. The workspace is a
 * choice among the ones the reader may add a project to, and a typed name's
 * rule stands under its field before anything is typed.
 *
 * A reader with nothing to choose is drawn an empty state where the form
 * would be, and what its page leads the form with is not drawn over it.
 *
 * One operation identity is held while both names stand, so pressing again
 * after an answer that never arrived repeats that creation rather than asking
 * for a second one.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";
import type { ReactNode } from "react";

import { apiCallerTenants, apiSiteAbilities } from "../core/accessRoutes.ts";
import { apiCreateProject } from "../core/apiRoutes.ts";
import { base64urlFromBytes } from "../core/base64url.ts";
import { lastProjectWrite } from "../core/lastProject.ts";
import { operationIdBytesCount } from "../core/operationFollow.ts";
import {
  projectCreationNameFault,
  projectCreationOutcome,
  projectCreationSendable,
  projectNameRule,
} from "../core/projectCreation.ts";
import type { ProjectCreationForm as ProjectCreationFields } from "../core/projectCreation.ts";
import {
  projectCreationWorkspaceChosen,
  projectCreationWorkspaceEntryText,
  projectCreationWorkspaceOffer,
  projectCreationWorkspaceTenant,
} from "../core/projectCreationWorkspace.ts";
import type {
  ProjectCreationWorkspaceDrawn,
  ProjectCreationWorkspaceEdits,
  ProjectCreationWorkspaceOffer,
} from "../core/projectCreationWorkspace.ts";
import { projectsInventoryKey } from "../core/projectQueryKeys.ts";
import { useApiPorts, usePanelCallerResource } from "./api.ts";
import { PanelUnready } from "./DataPanel.tsx";
import { Footer } from "./Footer.tsx";
import { clipboardWritten, drawBytes, persistentStore } from "./ports.ts";
import { siteAbilitiesResource } from "./settings/tenantPermissionsResource.ts";
import { TopBar } from "./shell/TopBar.tsx";
import { Button } from "./ui/Button.tsx";
import { CopyProvider } from "./ui/copyHeld.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Input } from "./ui/Input.tsx";
import { Notice } from "./ui/Notice.tsx";
import { Picker } from "./ui/Picker.tsx";

/** No frame names this read. */
const callerTenantsResource = "access-workspaces";

const fieldClassName = "grid gap-1 text-sm text-ink-2";

function drawnOperation(): string {
  return base64urlFromBytes(drawBytes(operationIdBytesCount));
}

interface ProjectCreationNameProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}

/** A name's box and, under it, the rule or the name's fault against it. */
function ProjectCreationNameBox(props: ProjectCreationNameProps): ReactNode {
  const ruleId = useId();
  const fault = projectCreationNameFault(props.value);
  return (
    <>
      <Input
        label={props.label}
        value={props.value}
        onChange={props.onChange}
        invalid={fault !== undefined}
        describedBy={ruleId}
      />
      <span
        id={ruleId}
        className={`text-xs ${fault === undefined ? "text-ink-3" : "text-tone-fail"}`}
      >
        {fault ?? projectNameRule}
      </span>
    </>
  );
}

function ProjectCreationName(props: ProjectCreationNameProps): ReactNode {
  return (
    <label className={fieldClassName}>
      {props.label}
      <ProjectCreationNameBox {...props} />
    </label>
  );
}

interface ProjectCreationWorkspaceProps {
  readonly edits: ProjectCreationWorkspaceEdits;
  readonly onEdit: (edits: ProjectCreationWorkspaceEdits) => void;
}

/** The choice, its entries told apart by their place in it because a
 * workspace may be called what another entry is, and the name field under it
 * while the making of a workspace is chosen. */
function ProjectCreationWorkspaceChoice(
  props: ProjectCreationWorkspaceProps & {
    readonly offer: Extract<
      ProjectCreationWorkspaceOffer,
      { readonly offer: "Choice" }
    >;
  },
): ReactNode {
  const { offer, edits, onEdit } = props;
  const chosen = projectCreationWorkspaceChosen(offer, edits.picked);
  return (
    <div className={fieldClassName}>
      <span>Workspace</span>
      <div className="min-w-0">
        <Picker
          label="Workspace"
          align="start"
          value={String(offer.entries.indexOf(chosen))}
          options={offer.entries.map((entry, at) => ({
            value: String(at),
            text: projectCreationWorkspaceEntryText(entry),
          }))}
          onChoose={(at) => {
            const picked = offer.entries[Number(at)];
            if (picked !== undefined) onEdit({ ...edits, picked });
          }}
        />
      </div>
      {chosen.entry === "New" ? (
        <ProjectCreationNameBox
          label="Workspace"
          value={projectCreationWorkspaceTenant(offer, edits)}
          onChange={(typed) => {
            onEdit({ ...edits, typed });
          }}
        />
      ) : null}
    </div>
  );
}

function ProjectCreationWorkspace(
  props: ProjectCreationWorkspaceProps & {
    readonly offer: ProjectCreationWorkspaceDrawn;
  },
): ReactNode {
  const { offer, edits, onEdit } = props;
  switch (offer.offer) {
    case "Pending":
      return (
        <div className={fieldClassName}>
          <span>Workspace</span>
          <PanelUnready state={{ state: "Pending" }} />
        </div>
      );
    case "Typed":
      return (
        <ProjectCreationName
          label="Workspace"
          value={projectCreationWorkspaceTenant(offer, edits)}
          onChange={(typed) => {
            onEdit({ ...edits, typed });
          }}
        />
      );
    case "Choice":
      return (
        <ProjectCreationWorkspaceChoice
          offer={offer}
          edits={edits}
          onEdit={onEdit}
        />
      );
  }
}

/** One creation sent under the identity its fields hold, and the line a
 * refusal left; `edited` is told of every change to what would be sent. */
function useProjectCreationSend(): {
  readonly busy: boolean;
  readonly status: string | undefined;
  readonly edited: () => void;
  readonly create: (fields: ProjectCreationFields) => void;
} {
  const ports = useApiPorts();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [operation, setOperation] = useState(drawnOperation);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const edited = (): void => {
    setOperation(drawnOperation());
    setStatus(undefined);
  };
  const create = (fields: ProjectCreationFields): void => {
    setBusy(true);
    setStatus(undefined);
    void (async () => {
      const outcome = projectCreationOutcome(
        await apiCreateProject(ports, fields, operation),
      );
      setBusy(false);
      if (outcome.outcome === "Refused") {
        setStatus(outcome.status);
        return;
      }
      lastProjectWrite(persistentStore, outcome.partition);
      await client.invalidateQueries({ queryKey: projectsInventoryKey() });
      void navigate({
        to: "/$tenant/$project/repositories",
        params: outcome.partition,
      });
    })();
  };
  return { busy, status, edited, create };
}

function ProjectCreationForm(props: {
  readonly offer: ProjectCreationWorkspaceDrawn;
}): ReactNode {
  const [workspace, setWorkspace] = useState<ProjectCreationWorkspaceEdits>({
    picked: undefined,
    typed: undefined,
  });
  const [project, setProject] = useState("");
  const send = useProjectCreationSend();
  const fields: ProjectCreationFields = {
    tenant: projectCreationWorkspaceTenant(props.offer, workspace),
    project,
  };
  return (
    <div className="grid w-full max-w-aside gap-3">
      <ProjectCreationWorkspace
        offer={props.offer}
        edits={workspace}
        onEdit={(edits) => {
          setWorkspace(edits);
          send.edited();
        }}
      />
      <ProjectCreationName
        label="Project"
        value={project}
        onChange={(name) => {
          setProject(name);
          send.edited();
        }}
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          variant="primary"
          disabled={!projectCreationSendable(fields) || send.busy}
          busy={send.busy}
          onClick={() => {
            send.create(fields);
          }}
        >
          Create project
        </Button>
        {send.status === undefined ? null : (
          <Notice tone="info" inline role="status" detail={send.status} />
        )}
      </div>
    </div>
  );
}

/**
 * The form under what its page leads it with, starting on the workspace it is
 * given, or the empty state that stands in for both.
 */
export function ProjectCreation(props: {
  readonly workspace?: string | undefined;
  readonly lead?: ReactNode;
}): ReactNode {
  const offer = projectCreationWorkspaceOffer(
    usePanelCallerResource(callerTenantsResource, (ports) =>
      apiCallerTenants(ports),
    ),
    usePanelCallerResource(siteAbilitiesResource, (ports) =>
      apiSiteAbilities(ports),
    ),
    props.workspace,
  );
  if (offer.offer === "Withheld")
    return (
      <EmptyState variant="page" label={offer.label} detail={offer.detail} />
    );
  return (
    <>
      {props.lead}
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
  return (
    <ProjectlessFrame>
      <ProjectCreation
        workspace={props.workspace}
        lead={<h1 className="text-md font-strong text-ink-1">New project</h1>}
      />
    </ProjectlessFrame>
  );
}
