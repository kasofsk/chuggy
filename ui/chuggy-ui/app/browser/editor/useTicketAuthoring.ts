/**
 * The two reads the editor needs while a ticket is being written: the catalog
 * the document may reference, and the verdict the server would reach on it.
 *
 * Validation is asked for once the typing stops rather than on every keystroke,
 * because each call resolves a pinned repository tree on the server. Both hooks
 * hold the pinned commit in a ref, so the catalog handed to the editor at mount
 * keeps working after the author changes which commit they are writing against.
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
function pinOf(catalogCommit: string, repository?: string): CatalogPin {
  return {
    catalogCommit,
    ...(repository === undefined || repository === "" ? {} : { repository }),
  };
}

export function useTicketValidation(
  partition: PartitionIdentity,
  pin: AuthoringPin,
): readonly EditorFinding[] {
  const ports = useApiPorts();
  const [findings, setFindings] = useState<readonly EditorFinding[]>([]);
  const { tenant, project } = partition;
  const { source, catalogCommit, repository } = pin;
  useEffect(() => {
    if (catalogCommit === "") return;
    let active = true;
    const timer = setTimeout(() => {
      void adoptedTicketValidate(
        ports,
        { tenant, project },
        {
          source,
          ...pinOf(catalogCommit, repository),
        },
      ).then((result) => {
        if (!active) return;
        setFindings(
          result.outcome === "Ok"
            ? result.value.findings.map((message) => ({
                message,
                severity: "error" as const,
              }))
            : [],
        );
      });
    }, validationIdleMs);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [ports, tenant, project, source, catalogCommit, repository]);
  return findings;
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
  const { catalogCommit, repository } = pin;
  useEffect(() => {
    if (catalogCommit === "") return;
    let active = true;
    void adoptedCatalog(
      ports,
      { tenant, project },
      pinOf(catalogCommit, repository),
    ).then((result) => {
      if (active)
        setFiles(
          result.outcome === "Ok"
            ? result.value.entries.map((entry) => entry.path)
            : [],
        );
    });
    return () => {
      active = false;
    };
  }, [ports, tenant, project, catalogCommit, repository]);
  const catalog = useMemo<FragmentCatalog>(
    () => ({
      load: async (reference) => {
        const result = await adoptedCatalogFile(
          ports,
          { tenant, project },
          pinOf(held.current.catalogCommit, held.current.repository),
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
