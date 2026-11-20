/**
 * Making one access token, in a dialog: its name, Read or Write, and how long
 * it stands, over one line saying what it is for and linking the docs page on
 * using one. A refusal is one line under
 * the form with everything typed still there. A token made replaces the form
 * with its secret, which only `Done` or Escape puts away, because the secret
 * is shown this once.
 *
 * CLOSING FORGETS THE SECRET. The dialog's state holds the mint's answer, and
 * closing it, or the dialog going away, drops that answer from the write and
 * from the cache the write kept it in. The write keeps no answer once no
 * screen holds it, so a mint that lands after the dialog went is dropped too,
 * and nothing holds the secret once it is put away.
 */

import { useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import type {
  AccessTokenAccess,
  AccessTokenMintedResponse,
} from "../../../../../src/contract/accessToken.ts";
import { accessTokenAccesses } from "../../../../../src/contract/accessToken.ts";
import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import {
  accessTokenAccessLabel,
  accessTokenDocsAddress,
  accessTokenFormBlank,
  accessTokenLifetimeLabel,
  accessTokenLifetimesDays,
  accessTokenMintBody,
  accessTokenMintRefusal,
  accessTokenMintSendable,
  accessTokenMintWords,
  accessTokenNameFault,
  accessTokensWords,
} from "../../core/accessTokens.ts";
import type { AccessTokenForm } from "../../core/accessTokens.ts";
import { apiMintAccessToken } from "../../core/apiRoutes.ts";
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type { ConsoleWrite } from "../../core/consoleWrite.ts";
import type { CopyText } from "../../core/copy.ts";
import { useConsoleWrite } from "../consoleWrite.tsx";
import { CopyButton } from "../ui/CopyButton.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Input } from "../ui/Input.tsx";
import { Picker } from "../ui/Picker.tsx";
import { RadioGroup } from "../ui/RadioGroup.tsx";
import { accessTokensReread } from "./accessTokensResource.ts";
import {
  invitationLabelClassName,
  InvitationText,
} from "./InvitationFields.tsx";
import { InviteFoot } from "./InviteDialog.tsx";

/** One token made, over once the list has answered again. */
function accessTokenMintWrite(
  partition: PartitionIdentity,
  text: CopyText,
): ConsoleWrite<AccessTokenForm, AccessTokenMintedResponse> {
  return {
    mutationKey: consoleWriteKey(
      "access-token-mint",
      partition.tenant,
      partition.project,
    ),
    write: (ports, form) =>
      apiMintAccessToken(ports, partition, accessTokenMintBody(form)),
    refusal: (failure) => text(accessTokenMintRefusal(failure)),
    landed: (client) => accessTokensReread(client, partition),
    gcTime: 0,
  };
}

/** Every answered mint under `write`'s key taken out of the cache, so the
 * secret one answered is held by nothing. */
function accessTokenMintForgotten(
  client: QueryClient,
  write: ConsoleWrite<AccessTokenForm, AccessTokenMintedResponse>,
): void {
  const cache = client.getMutationCache();
  for (const mutation of cache.findAll({
    mutationKey: write.mutationKey,
    exact: true,
  }))
    if (mutation.state.status !== "pending") cache.remove(mutation);
}

interface AccessTokenMinting {
  readonly form: AccessTokenForm;
  readonly made: AccessTokenMintedResponse | undefined;
  readonly busy: boolean;
  readonly status: string | undefined;
  readonly change: (form: AccessTokenForm) => void;
  /** The dialog opening or closing: nothing typed, made or said. */
  readonly begin: () => void;
  readonly mint: () => void;
}

function useAccessTokenMint(
  partition: PartitionIdentity,
  open: boolean,
): AccessTokenMinting {
  const text = useCopyText();
  const client = useQueryClient();
  const write = accessTokenMintWrite(partition, text);
  const [form, setForm] = useState(accessTokenFormBlank);
  const minting = useConsoleWrite(write, { drawn: open });
  useEffect(
    () => () => {
      accessTokenMintForgotten(client, write);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the write is forgotten by its key, which a fresh write of the same partition keeps
    [client, partition.tenant, partition.project],
  );
  return {
    form,
    made: minting.isSuccess ? minting.data : undefined,
    busy: minting.isPending,
    status: minting.error?.message,
    change: setForm,
    begin: () => {
      setForm(accessTokenFormBlank);
      minting.reset();
      accessTokenMintForgotten(client, write);
    },
    mint: () => {
      minting.mutate(form);
    },
  };
}

/** The docs page on using a token, as a link in a line of the dialog. */
function AccessTokenHowToUse(): ReactNode {
  const text = useCopyText();
  return (
    <a href={accessTokenDocsAddress} rel="noopener noreferrer" target="_blank">
      {text(accessTokenMintWords.how)}
    </a>
  );
}

/** A token just made, as the whole body of the dialog: its secret in a field
 * a reader selects from, the control that copies it, the line that says it is
 * not shown again, and the line that says where it is used. */
function AccessTokenMade(props: {
  readonly minted: AccessTokenMintedResponse;
}): ReactNode {
  const text = useCopyText();
  const secret = props.minted.secret;
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <Input
          readOnly
          label={text(accessTokenMintWords.secret)}
          value={secret}
        />
        <CopyButton
          text={secret}
          label={text(accessTokenMintWords.copy)}
          worded
        />
      </div>
      <p className="m-0 text-sm text-ink-3">
        {text(accessTokenMintWords.shownOnce)}
      </p>
      <p className="m-0 text-sm text-ink-3">
        {text(accessTokenMintWords.use)} <AccessTokenHowToUse />
      </p>
    </div>
  );
}

function AccessTokenAccessChoice(props: {
  readonly access: AccessTokenAccess;
  readonly onChoose: (access: AccessTokenAccess) => void;
}): ReactNode {
  const text = useCopyText();
  const label = text(accessTokensWords.access);
  return (
    <div className="grid gap-2">
      <span aria-hidden="true" className={invitationLabelClassName}>
        {label}
      </span>
      <RadioGroup
        label={label}
        value={props.access}
        options={accessTokenAccesses.map((access) => ({
          value: access,
          text: text(accessTokenAccessLabel(access)),
        }))}
        onChoose={(value) => {
          const access = accessTokenAccesses.find((known) => known === value);
          if (access !== undefined) props.onChoose(access);
        }}
      />
    </div>
  );
}

function AccessTokenFields(props: {
  readonly minting: AccessTokenMinting;
}): ReactNode {
  const text = useCopyText();
  const { form, change } = props.minting;
  const fault = accessTokenNameFault(form.name);
  const expires = text(accessTokensWords.expires);
  return (
    <div className="grid gap-4">
      <InvitationText
        label={text(accessTokensWords.name)}
        value={form.name}
        fault={fault === undefined ? undefined : text(fault)}
        onChange={(name) => {
          change({ ...form, name });
        }}
      />
      <AccessTokenAccessChoice
        access={form.access}
        onChoose={(access) => {
          change({ ...form, access });
        }}
      />
      <div className="grid justify-items-start gap-2">
        <span aria-hidden="true" className={invitationLabelClassName}>
          {expires}
        </span>
        <Picker
          label={expires}
          value={String(form.lifetimeDays)}
          options={accessTokenLifetimesDays.map((days) => ({
            value: String(days),
            text: text(accessTokenLifetimeLabel(days)),
          }))}
          onChoose={(value) => {
            const days = accessTokenLifetimesDays.find(
              (known) => String(known) === value,
            );
            if (days !== undefined) change({ ...form, lifetimeDays: days });
          }}
        />
      </div>
      <p className="m-0 text-sm text-ink-3">
        {text(accessTokenMintWords.own)} <AccessTokenHowToUse />
      </p>
    </div>
  );
}

export function AccessTokenMint(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const text = useCopyText();
  const [open, setOpen] = useState(false);
  const minting = useAccessTokenMint(props.partition, open);
  const moved = (opened: boolean): void => {
    minting.begin();
    setOpen(opened);
  };
  return (
    <Dialog
      size="form"
      title={text(accessTokensWords.create)}
      trigger={text(accessTokensWords.create)}
      open={open}
      onOpenChange={moved}
      busy={minting.busy}
      kept={minting.made !== undefined}
      note={minting.status}
      foot={
        <InviteFoot
          made={minting.made !== undefined}
          busy={minting.busy}
          sendable={accessTokenMintSendable(minting.form)}
          words={{
            idle: accessTokenMintWords.send,
            busy: accessTokenMintWords.sending,
          }}
          onSend={minting.mint}
          onClose={() => {
            moved(false);
          }}
        />
      }
    >
      {minting.made === undefined ? (
        <AccessTokenFields minting={minting} />
      ) : (
        <AccessTokenMade minted={minting.made} />
      )}
    </Dialog>
  );
}
