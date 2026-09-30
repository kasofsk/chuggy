/**
 * Making a project: the workspace it belongs to, its own name, and one submit,
 * on the landing a reader with no project meets and at its own address.
 *
 * One operation identity is held while both names stand, so pressing again
 * after an answer that never arrived repeats that creation rather than asking
 * for a second one.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";
import type { ReactNode } from "react";

import { apiCreateProject } from "../core/apiRoutes.ts";
import { base64urlFromBytes } from "../core/base64url.ts";
import { lastProjectWrite } from "../core/lastProject.ts";
import { operationIdBytesCount } from "../core/operationFollow.ts";
import {
  projectCreationNameFault,
  projectCreationOutcome,
  projectCreationSendable,
} from "../core/projectCreation.ts";
import type { ProjectCreationForm as ProjectCreationFields } from "../core/projectCreation.ts";
import { projectsInventoryKey } from "../core/projectQueryKeys.ts";
import { useApiPorts } from "./api.ts";
import { drawBytes, persistentStore } from "./ports.ts";
import { TopBar } from "./shell/TopBar.tsx";
import { Button } from "./ui/Button.tsx";
import { Input } from "./ui/Input.tsx";
import { Notice } from "./ui/Notice.tsx";

function drawnOperation(): string {
  return base64urlFromBytes(drawBytes(operationIdBytesCount));
}

function ProjectCreationName(props: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}): ReactNode {
  const faultId = useId();
  const fault = projectCreationNameFault(props.value);
  return (
    <label className="grid gap-1 text-sm text-ink-2">
      {props.label}
      <Input
        label={props.label}
        value={props.value}
        onChange={props.onChange}
        invalid={fault !== undefined}
        {...(fault === undefined ? {} : { describedBy: faultId })}
      />
      {fault === undefined ? null : (
        <span id={faultId} className="text-xs text-tone-fail">
          {fault}
        </span>
      )}
    </label>
  );
}

export function ProjectCreationForm(): ReactNode {
  const ports = useApiPorts();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [fields, setFields] = useState<ProjectCreationFields>({
    tenant: "",
    project: "",
  });
  const [operation, setOperation] = useState(drawnOperation);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const edit = (next: ProjectCreationFields): void => {
    setFields(next);
    setOperation(drawnOperation());
    setStatus(undefined);
  };
  const create = (): void => {
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
  return (
    <div className="grid w-full max-w-aside gap-3">
      <ProjectCreationName
        label="Workspace"
        value={fields.tenant}
        onChange={(tenant) => {
          edit({ ...fields, tenant });
        }}
      />
      <ProjectCreationName
        label="Project"
        value={fields.project}
        onChange={(project) => {
          edit({ ...fields, project });
        }}
      />
      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          disabled={!projectCreationSendable(fields) || busy}
          busy={busy}
          onClick={create}
        >
          Create project
        </Button>
        {status === undefined ? null : (
          <Notice tone="info" inline role="status" detail={status} />
        )}
      </div>
    </div>
  );
}

/** A screen outside every project: the bar, and the page under it. */
export function ProjectlessFrame(props: {
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="grid min-h-dvh content-start">
      <TopBar partition={undefined} />
      <main className="grid gap-4 p-4">{props.children}</main>
    </div>
  );
}

export function ProjectCreationPage(): ReactNode {
  return (
    <ProjectlessFrame>
      <h1 className="text-md font-strong text-ink-1">New project</h1>
      <ProjectCreationForm />
    </ProjectlessFrame>
  );
}
