/**
 * Where a person approves a device's sign-in: the code the device shows,
 * filled from the link where the device sent one, and Continue, which hands it
 * to the issuer with the challenge the link carries.
 *
 * Until pressed the card says to enter only a code on a device the person is
 * using, since a code read out by someone else signs that someone in as them.
 * A press is busy for its one call, and a refusal takes the guard's line.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import { useCopyText } from "../copy/CopyProvider.tsx";
import type { Copy } from "../core/copy.ts";
import {
  apiDeviceApproval,
  deviceApprovalSent,
} from "../core/deviceApproval.ts";
import type { DeviceQuery } from "../core/deviceApproval.ts";
import { useApiPorts } from "./api.ts";
import { redirect } from "./ports.ts";
import { SessionCard } from "./SessionCard.tsx";
import { Button } from "./ui/Button.tsx";
import { Input } from "./ui/Input.tsx";

export function DevicePage(props: { readonly query: DeviceQuery }): ReactNode {
  const { challenge } = props.query;
  const text = useCopyText();
  const ports = useApiPorts();
  const [code, setCode] = useState(props.query.userCode ?? "");
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<Copy | undefined>(undefined);
  if (challenge === undefined)
    return (
      <SessionCard
        title={text({ id: "device-title" })}
        detail={text({ id: "device-unlinked" })}
      />
    );
  const press = async (): Promise<void> => {
    setBusy(true);
    const sent = deviceApprovalSent(
      await apiDeviceApproval(ports, challenge, code.trim()),
    );
    if (sent.sent === "Approved") {
      redirect(sent.redirectTo);
      return;
    }
    setRefused(sent.line);
    setBusy(false);
  };
  return (
    <SessionCard
      title={text({ id: "device-title" })}
      media={
        <Input
          label={text({ id: "device-code" })}
          value={code}
          invalid={refused !== undefined}
          disabled={busy}
          autoFocus
          onChange={(typed) => {
            setCode(typed);
            setRefused(undefined);
          }}
        />
      }
      detail={text(refused ?? { id: "device-guard" })}
      action={
        <Button
          variant="primary"
          busy={busy}
          disabled={busy || code.trim() === ""}
          onClick={() => {
            void press();
          }}
        >
          {text({ id: "device-continue" })}
        </Button>
      }
    />
  );
}

export function DeviceDonePage(): ReactNode {
  const text = useCopyText();
  return (
    <SessionCard
      title={text({ id: "device-done-title" })}
      detail={text({ id: "device-done" })}
    />
  );
}
