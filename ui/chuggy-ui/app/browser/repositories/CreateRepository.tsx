/**
 * Creating a repository on the forge and binding it here: the account it is
 * made under, what it is called, who may read it, and every step the create
 * took.
 *
 * Only an account holding both apps is offered, because the create makes the
 * repository through one installation and leaves the work to the other's. A
 * refusal is one line under the form, as the picker's is.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ForgeInstallationResponse } from "../../../../../src/contract/responses.ts";
import { forgeRepositoryVisibilities } from "../../../../../src/contract/rosters.ts";
import type { ForgeRepositoryVisibilityName } from "../../../../../src/contract/rosters.ts";
import { apiCreateProjectRepository } from "../../core/apiRoutes.ts";
import { base64urlFromBytes } from "../../core/base64url.ts";
import { forgeCreatingAccounts } from "../../core/forgeInstallation.ts";
import { operationIdBytesCount } from "../../core/operationFollow.ts";
import { projectResourceKey } from "../../core/projectQueryKeys.ts";
import {
  repositoryCreateNameFault,
  repositoryCreateOutcome,
  repositoryCreatedRows,
  repositoryVisibilityLabel,
} from "../../core/projectRepositoryCreate.ts";
import type {
  RepositoryCreateForm,
  RepositoryCreateOutcome,
} from "../../core/projectRepositoryCreate.ts";
import { useApiPorts } from "../api.ts";
import { drawBytes } from "../ports.ts";
import { Button } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Field, Fields } from "../ui/Fields.tsx";
import { Input } from "../ui/Input.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Picker } from "../ui/Picker.tsx";
import { RadioGroup } from "../ui/RadioGroup.tsx";
import { projectRepositoriesResource } from "./AddRepository.tsx";

const visibilityOptions = forgeRepositoryVisibilities.map((visibility) => ({
  value: visibility,
  text: repositoryVisibilityLabel(visibility),
}));

/** One create, from the identity it spends to the rows it leaves behind. */
function useRepositoryCreate(partition: PartitionIdentity): {
  readonly outcome: RepositoryCreateOutcome | undefined;
  readonly busy: boolean;
  readonly create: (form: RepositoryCreateForm) => void;
} {
  const ports = useApiPorts();
  const client = useQueryClient();
  const [outcome, setOutcome] = useState<RepositoryCreateOutcome | undefined>(
    undefined,
  );
  const [busy, setBusy] = useState(false);
  return {
    outcome,
    busy,
    create: (form) => {
      setBusy(true);
      setOutcome(undefined);
      void (async () => {
        const answered = repositoryCreateOutcome(
          await apiCreateProjectRepository(
            ports,
            partition,
            form,
            base64urlFromBytes(drawBytes(operationIdBytesCount)),
          ),
        );
        setBusy(false);
        setOutcome(answered);
        if (answered.outcome === "Refused") return;
        await client.invalidateQueries({
          queryKey: projectResourceKey(
            partition,
            "Project",
            projectRepositoriesResource,
          ),
        });
      })();
    },
  };
}

/** What the create came to: one line for a refusal, a row per step otherwise. */
function CreateOutcome(props: {
  readonly outcome: RepositoryCreateOutcome;
}): ReactNode {
  if (props.outcome.outcome === "Refused")
    return (
      <Notice tone="info" inline role="status" detail={props.outcome.status} />
    );
  const created = props.outcome.created;
  return (
    <div role="status">
      <Fields variant="inline">
        <Field name="Repository">
          <a
            href={created.created.url}
            rel="noopener noreferrer"
            target="_blank"
          >
            {created.created.name}
          </a>
        </Field>
        {repositoryCreatedRows(created).map((row) => (
          <Field key={row.label} name={row.label}>
            {row.detail}
          </Field>
        ))}
      </Fields>
    </div>
  );
}

function CreateRepositoryBody(props: {
  readonly partition: PartitionIdentity;
  readonly accounts: readonly string[];
}): ReactNode {
  const [account, setAccount] = useState(props.accounts[0] ?? "");
  const [name, setName] = useState("");
  const [visibility, setVisibility] =
    useState<ForgeRepositoryVisibilityName>("private");
  const creating = useRepositoryCreate(props.partition);
  const fault = repositoryCreateNameFault(name);
  return (
    <>
      <Picker
        label="Account"
        value={account}
        options={props.accounts.map((held) => ({ value: held, text: held }))}
        onChoose={setAccount}
      />
      <Input
        label="Name"
        value={name}
        onChange={setName}
        invalid={name !== "" && fault !== undefined}
      />
      <RadioGroup
        label="Visibility"
        value={visibility}
        options={visibilityOptions}
        onChoose={(chosen) => {
          const held = forgeRepositoryVisibilities.find(
            (candidate) => candidate === chosen,
          );
          if (held !== undefined) setVisibility(held);
        }}
      />
      <Button
        size="sm"
        disabled={fault !== undefined || creating.busy}
        onClick={() => {
          creating.create({ account, name, visibility });
        }}
      >
        Create
      </Button>
      {creating.outcome === undefined ? null : (
        <CreateOutcome outcome={creating.outcome} />
      )}
    </>
  );
}

export function CreateRepository(props: {
  readonly partition: PartitionIdentity;
  readonly installations: readonly ForgeInstallationResponse[];
}): ReactNode {
  const [open, setOpen] = useState(false);
  const accounts = forgeCreatingAccounts(props.installations);
  return (
    <Dialog
      title="Create"
      trigger="Create"
      triggerDisabled={accounts.length === 0}
      open={open}
      onOpenChange={setOpen}
    >
      <CreateRepositoryBody partition={props.partition} accounts={accounts} />
    </Dialog>
  );
}
