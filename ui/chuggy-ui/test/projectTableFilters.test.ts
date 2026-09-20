import { describe, expect, test } from "vitest";

import {
  ticketFilterAll,
  ticketFilterRoster,
  ticketFilterSections,
  ticketFilterTitle,
} from "../app/core/projectTableFilters.ts";
import { ticketSectionRoster } from "../app/core/ticketSections.ts";

describe("the table's filters", () => {
  test("every section is offered, and so is the whole project", () => {
    expect(ticketFilterRoster).toEqual([
      ticketFilterAll,
      ...ticketSectionRoster,
    ]);
  });

  test("all draws every section and a section draws itself alone", () => {
    expect(ticketFilterSections(ticketFilterAll)).toEqual(ticketSectionRoster);
    expect(ticketFilterSections("NeedsYou")).toEqual(["NeedsYou"]);
  });

  test("a filter is named the way the section it draws is named", () => {
    expect(ticketFilterTitle(ticketFilterAll)).toBe("all");
    expect(ticketFilterTitle("Stopped")).toBe("failed or revoked");
  });
});
