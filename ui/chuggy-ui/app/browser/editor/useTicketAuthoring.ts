/**
 * The two reads the editor needs while a ticket is being written: the catalog
 * the document may reference, and the verdict the server would reach on it.
 *
 * Validation is asked for once the typing stops rather than on every keystroke,
 * because each call resolves the bound repository's tip on the server. That
 * verdict carries the commit it resolved against, which the form sends back
 * with the write so a tree that moved under the author refuses it rather than
 * releasing against a catalog nobody read.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import {
  adoptedCatalog,
  adoptedCatalogFile,
  adoptedTicketValidate,
  type CatalogPin,
} from "../../core/adoptedTickets.ts";
import { useApiPorts } from "../api.ts";
import type { EditorFinding } from "./chugEditor.ts";
import type { FragmentCatalog } from "./fragments.ts";

export const validationIdleMs = 600;

export interface AuthoringPin extends CatalogPin {
  readonly source: string;
}

/** An unbound repository is an absent header, not an empty one. */
function pinOf(repository?: string): CatalogPin {
  return repository === undefined || repository === "" ? {} : { repository };
}

/** The verdict, and what the server resolved it against for the write to guard on. */
export interface TicketValidation {
  readonly findings: readonly EditorFinding[];
  readonly commit: string | undefined;
}

export function useTicketValidation(
  partition: PartitionIdentity,
  pin: AuthoringPin,
): TicketValidation {
  const ports = useApiPorts();
  const [validation, setValidation] = useState<TicketValidation>({
    findings: [],
    commit: undefined,
  });
  const { tenant, project } = partition;
  const { source, repository } = pin;
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void adoptedTicketValidate(
        ports,
        { tenant, project },
        { source, ...pinOf(repository) },
      ).then((result) => {
        if (!active) return;
        setValidation(
          result.outcome === "Ok"
            ? {
                findings: result.value.findings.map((message) => ({
                  message,
                  severity: "error" as const,
                })),
                commit: result.value.commit,
              }
            : { findings: [], commit: undefined },
        );
      });
    }, validationIdleMs);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [ports, tenant, project, source, repository]);
  return validation;
}

export function useTicketCatalog(
  partition: PartitionIdentity,
  pin: CatalogPin,
  onError: (error: unknown) => void,
): {
  readonly files: readonly string[];
  readonly catalog: FragmentCatalog | undefined;
} {
  const ports = useApiPorts();
  const [files, setFiles] = useState<readonly string[]>([]);
  const { tenant, project } = partition;
  const held = useRef(pin);
  const reported = useRef(onError);
  useEffect(() => {
    held.current = pin;
    reported.current = onError;
  });
  const { repository } = pin;
  useEffect(() => {
    let active = true;
    void adoptedCatalog(ports, { tenant, project }, pinOf(repository)).then(
      (result) => {
        if (active)
          setFiles(
            result.outcome === "Ok"
              ? result.value.entries.map((entry) => entry.path)
              : [],
          );
      },
    );
    return () => {
      active = false;
    };
  }, [ports, tenant, project, repository]);
  const catalog = useMemo<FragmentCatalog>(
    () => ({
      load: async (reference) => {
        const result = await adoptedCatalogFile(
          ports,
          { tenant, project },
          pinOf(held.current.repository),
          reference,
        );
        if (result.outcome !== "Ok")
          throw new Error(`The catalog file could not be read: ${reference}.`);
        return { content: result.value.content };
      },
      onError: (error) => {
        reported.current(error);
      },
    }),
    [ports, tenant, project],
  );
  return { files, catalog };
}
