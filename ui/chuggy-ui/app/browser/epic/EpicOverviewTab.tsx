/**
 * The epic page's Overview tab: the epic's description, at reading width.
 */

import type { ReactNode } from "react";

import { useCopyText } from "../../copy/CopyProvider.tsx";
import { readValue } from "../ticket/TicketPageHeld.tsx";
import { MarkdownReport } from "../ui/MarkdownReport.tsx";
import { useEpicPageHeld } from "./EpicPageHeld.tsx";

import "./epicOverview.css";

export function EpicOverviewTab(): ReactNode {
  const held = useEpicPageHeld();
  const text = useCopyText();
  const view = readValue(held.epicState);
  if (view === undefined || view.description === "") return null;
  return (
    <section
      className="epic-overview"
      aria-label={text({ id: "epics-overview-description" })}
    >
      <MarkdownReport text={view.description} bare />
    </section>
  );
}
