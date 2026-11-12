/**
 * The repository's head in an imported configuration's place, where the
 * address asks for it: the head's own version drawn, and a line saying what
 * the head declares against what the newest import stored.
 *
 * THE HEAD IS READ ONLY WHEN THE ADDRESS NAMES IT. A read fetches from the
 * repository's forge, so nothing reads it otherwise, and the answer is kept
 * under the repository it was read from.
 */

import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { RepositoryConfigurationHeadResponse } from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { catalogQueryImported } from "../../core/catalogConfigurations.ts";
import type { CatalogQuery } from "../../core/catalogConfigurations.ts";
import { catalogEntriesOf } from "../../core/catalogEntries.ts";
import {
  catalogHeadDeclaration,
  catalogHeadFaultText,
  catalogHeadStandingOf,
  catalogHeadText,
} from "../../core/catalogHead.ts";
import { configurationCatalogOf } from "../../core/configurationCatalog.ts";
import { configurationHeadQuery } from "../../core/configurationQueries.ts";
import { usePanelState } from "../api.ts";
import type { PanelState } from "../../core/freshness.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { ConfigurationBody } from "../TicketProvenance.tsx";
import { Panel } from "../ui/Panel.tsx";
import { CatalogLink, CatalogShown } from "./CatalogShown.tsx";

function useCatalogHead(
  partition: PartitionIdentity,
  repository: string,
): PanelState<RepositoryConfigurationHeadResponse> {
  return usePanelState(configurationHeadQuery(partition, repository));
}

/** What the head says of one configuration while the address draws the head's version in the import's place. */
export function CatalogHeadLine(props: {
  readonly partition: PartitionIdentity;
  readonly repository: string;
  readonly name: string;
  readonly newestDigest: string;
  /** The address the head is drawn under, which the way back to the import narrows. */
  readonly query: CatalogQuery;
}): ReactNode {
  const text = useCopyText();
  const state = useCatalogHead(props.partition, props.repository);
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
        {text(catalogHeadText(standing, props.name))}{" "}
        <CatalogLink query={imported}>
          {text({ id: "configuration-catalog-show-import" })}
        </CatalogLink>
      </p>
      {standing.standing === "Refused" ? (
        <ul className="catalog-head-faults">
          {standing.faults.map((fault) => {
            const said = catalogHeadFaultText(fault);
            return (
              <li key={said}>
                <code>{said}</code>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/** The head's own version of one configuration, drawn as an imported one is, and the import where the head holds none. */
export function CatalogHeadRevision(props: {
  readonly partition: PartitionIdentity;
  readonly repository: string;
  readonly name: string;
  readonly query: CatalogQuery;
  readonly imported: ReactNode;
}): ReactNode {
  const text = useCopyText();
  const state = useCatalogHead(props.partition, props.repository);
  if (state.state !== "Ready") return <PanelUnready state={state} />;
  const declaration = catalogHeadDeclaration(state.value.head, props.name);
  if (declaration === undefined) return props.imported;
  const catalog = configurationCatalogOf(declaration.canonical);
  if (catalog === undefined)
    return (
      <Panel
        variant="section"
        title={text({ id: "configuration-catalog-version-one" })}
      >
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
