/**
 * The project the bar is showing, and every other project this reader may
 * read.
 *
 * A pick is a navigation, and the picked project is remembered so the next tab
 * opens where this one left off. An inventory that has not answered says so
 * rather than offering an empty list.
 */

import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { apiProjectInventoryAll } from "../../core/apiRoutes.ts";
import { lastProjectWrite } from "../../core/lastProject.ts";
import { usePanelInventory } from "../api.ts";
import { persistentStore } from "../ports.ts";
import { Notice } from "../ui/Notice.tsx";
import { Picker } from "../ui/Picker.tsx";

export function ProjectSwitcher(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const navigate = useNavigate();
  const state = usePanelInventory((ports) => apiProjectInventoryAll(ports));
  if (state.state !== "Ready")
    return <Notice tone="parked" inline detail="Projects unavailable" />;
  return (
    <Picker
      label="Project"
      value={`${props.partition.tenant}/${props.partition.project}`}
      options={state.value.map((candidate) => ({
        value: `${candidate.tenant}/${candidate.project}`,
        text: `${candidate.tenant} / ${candidate.project}`,
      }))}
      onChoose={(picked) => {
        const chosen = state.value.find(
          (candidate) => `${candidate.tenant}/${candidate.project}` === picked,
        );
        if (chosen === undefined) return;
        lastProjectWrite(persistentStore, chosen);
        void navigate({
          to: "/$tenant/$project",
          params: { tenant: chosen.tenant, project: chosen.project },
        });
      }}
    />
  );
}
