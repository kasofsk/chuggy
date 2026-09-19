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
import type { ApiFailure } from "../../core/apiRequest.ts";
import { useApiPorts } from "../api.ts";
import type { EditorFinding } from "./chugEditor.ts";
import { editorFindings } from "./findings.ts";
import type { FragmentCatalog } from "./fragments.ts";

export const validationIdleMs = 600;

export interface AuthoringPin extends CatalogPin {
  readonly source: string;
}

/** Why the catalog could not be listed, in words an author can act on. */
function unreadSentence(failure: ApiFailure): string {
  const why =
    "reason" in failure
      ? failure.reason
      : `the request ended with ${failure.outcome}`;
  return `The catalog could not be read, so no reference can be completed, previewed or materialised: ${why}.`;
}

/** An unbound repository is an absent header, not an empty one. */
function pinOf(repository?: string): CatalogPin {
  return repository === undefined || repository === "" ? {} : { repository };
}

/** The verdict, and what the server resolved it against for the write to guard on. */
export interface TicketValidation {
  readonly findings: readonly EditorFinding[];
  readonly commit: string | undefined;
  /**
   * Why there is no verdict, when there is none. A validation that could not be
   * asked for is not a document without faults, and reporting it as one would
   * offer the author a clean editor over a question nobody answered.
   */
  readonly unanswered: ApiFailure | undefined;
}

export function useTicketValidation(
  partition: PartitionIdentity,
  pin: AuthoringPin,
): TicketValidation {
  const ports = useApiPorts();
  const [validation, setValidation] = useState<TicketValidation>({
    findings: [],
    commit: undefined,
    unanswered: undefined,
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
                findings: editorFindings(result.value.findings, source),
                commit: result.value.commit,
                unanswered: undefined,
              }
            : { findings: [], commit: undefined, unanswered: result },
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
        if (!active) return;
        setFiles(
          result.outcome === "Ok"
            ? result.value.entries.map((entry) => entry.path)
            : [],
        );
        /**
         * An unread catalog is not an empty one. Every affordance over a
         * reference is gated on the file list, so a swallowed failure takes
         * the completions, the previews and the materialise action with it and
         * leaves an editor that looks merely unhelpful.
         */
        if (result.outcome !== "Ok")
          reported.current(new Error(unreadSentence(result)));
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
