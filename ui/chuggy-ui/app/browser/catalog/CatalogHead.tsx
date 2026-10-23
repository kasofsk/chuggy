/**
 * The repository's head beside an imported configuration: a line saying
 * whether the head declares what the newest import stored, and the head's own
 * version drawn in the import's place where the address asks for it.
 *
 * THE HEAD IS READ ONLY WHEN ASKED. A read fetches from the repository's
 * forge, so nothing reads it until a reader presses for it or the address
 * names it, and the answer is kept under the repository it was read from.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { RepositoryConfigurationHeadResponse } from "../../../../../src/contract/responses.ts";
import { apiRepositoryConfigurationHead } from "../../core/apiRoutes.ts";
import { catalogQueryImported } from "../../core/catalogConfigurations.ts";
import type { CatalogQuery } from "../../core/catalogConfigurations.ts";
import { catalogEntriesOf } from "../../core/catalogEntries.ts";
import {
  catalogHeadDeclaration,
  catalogHeadFaultText,
  catalogHeadShowingText,
  catalogHeadStandingOf,
  catalogHeadText,
} from "../../core/catalogHead.ts";
import { configurationCatalogOf } from "../../core/configurationCatalog.ts";
import { usePanelResourceAsked } from "../api.ts";
import type { PanelState } from "../../core/freshness.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { ConfigurationBody } from "../TicketProvenance.tsx";
import { Button } from "../ui/Button.tsx";
import { Panel } from "../ui/Panel.tsx";
import { CatalogLink, CatalogShown } from "./CatalogShown.tsx";

function useCatalogHead(
  partition: PartitionIdentity,
  repository: string,
  asked: boolean,
): PanelState<RepositoryConfigurationHeadResponse> {
  return usePanelResourceAsked(
    partition,
    "Configuration",
    `head:${repository}`,
    (ports) => apiRepositoryConfigurationHead(ports, partition, repository),
    undefined,
    asked,
  );
}

/** The head against the newest import of one configuration, read once a reader asks. */
export function CatalogHeadLine(props: {
  readonly partition: PartitionIdentity;
  readonly repository: string;
  readonly name: string;
  readonly newestDigest: string;
  /** The address the import is drawn under, which the head's link extends. */
  readonly query: CatalogQuery;
}): ReactNode {
  const showing = props.query.source === "head";
  const [pressed, setPressed] = useState(false);
  const asked = pressed || showing;
  const state = useCatalogHead(props.partition, props.repository, asked);
  if (!asked)
    return (
      <p className="catalog-head">
        <Button
          variant="quiet"
          size="sm"
          onClick={() => {
            setPressed(true);
          }}
        >
          Compare with the repository head
        </Button>
      </p>
    );
  if (state.state !== "Ready") return <PanelUnready state={state} />;
  const standing = catalogHeadStandingOf(
    state.value.head,
    props.name,
    props.newestDigest,
  );
  const imported = catalogQueryImported(props.query);
  return (
    <div className="catalog-head" role="status">
      <p>
        {showing && standing.standing !== "Unread"
          ? catalogHeadShowingText(standing.at, props.name)
          : catalogHeadText(standing, props.name)}{" "}
        {showing ? (
          <CatalogLink query={imported}>Show the import</CatalogLink>
        ) : standing.standing === "Differs" ? (
          <CatalogLink query={{ ...imported, source: "head" }}>
            Show the head
          </CatalogLink>
        ) : null}
      </p>
      {standing.standing === "Refused" ? (
        <ul className="catalog-head-faults">
          {standing.faults.map((fault) => {
            const text = catalogHeadFaultText(fault);
            return (
              <li key={text}>
                <code>{text}</code>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/** The head's own version of one configuration, drawn as an imported one is. */
export function CatalogHeadRevision(props: {
  readonly partition: PartitionIdentity;
  readonly repository: string;
  readonly name: string;
  readonly query: CatalogQuery;
}): ReactNode {
  const state = useCatalogHead(props.partition, props.repository, true);
  if (state.state !== "Ready") return <PanelUnready state={state} />;
  const declaration = catalogHeadDeclaration(state.value.head, props.name);
  if (declaration === undefined) return null;
  const catalog = configurationCatalogOf(declaration.canonical);
  if (catalog === undefined)
    return (
      <Panel variant="section" title="Version 1 configuration">
        <ConfigurationBody
          configuration={{ partition: props.partition, ...declaration }}
          overrides={undefined}
          selection={undefined}
        />
      </Panel>
    );
  const { entry, ...base } = props.query;
  return (
    <CatalogShown
      base={base}
      canonical={declaration.canonical}
      entries={catalogEntriesOf(catalog, declaration.workloadPaths)}
      selected={entry}
    />
  );
}
