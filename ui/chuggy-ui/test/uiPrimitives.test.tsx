/**
 * The four small primitives, each over the whole state set it claims.
 *
 * They are one suite because each is a handful of markup and a suite per file
 * would be four copies of the same three assertions; what each case checks is
 * the accessible shape — a definition list, a table's scopes, a nav of anchors
 * — because that is the part a stylesheet cannot supply.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { Field, Fields, fieldsVariants } from "../app/browser/ui/Fields.tsx";
import { EmptyState, emptyVariants } from "../app/browser/ui/EmptyState.tsx";
import { Identity, identityForms } from "../app/browser/ui/Identity.tsx";
import { SectionList } from "../app/browser/ui/SectionList.tsx";
import { Table } from "../app/browser/ui/Table.tsx";

afterEach(cleanup);

test("an identity shows the short form and hovers the whole of it", () => {
  for (const form of identityForms) {
    const { container } = render(
      <Identity
        label={{ text: "cfaca0a", title: "cfaca0a1b2c3" }}
        block={form === "block"}
      />,
    );
    const drawn = screen.getByTitle("cfaca0a1b2c3");
    expect(drawn.textContent).toBe("cfaca0a");
    expect(drawn.classList.contains("identity-block")).toBe(form === "block");
    expect(container.querySelector("[style]")).toBeNull();
    cleanup();
  }
});

test("fields are a definition list in both variants, and an absence says so", () => {
  for (const variant of fieldsVariants) {
    const { container } = render(
      <Fields variant={variant}>
        <Field name="Branch">gg/footer</Field>
        <Field name="Links" absent>
          None
        </Field>
      </Fields>,
    );
    expect(container.querySelector("dl")).not.toBeNull();
    expect(container.querySelectorAll("dt")).toHaveLength(2);
    expect(screen.getByText("gg/footer").tagName).toBe("DD");
    expect(screen.getByText("None").classList.contains("field-absent")).toBe(
      true,
    );
    expect(
      container.querySelector("dl")?.classList.contains("fields-inline"),
    ).toBe(variant === "inline");
    cleanup();
  }
});

test("an empty state is a line inside a panel and a heading on a page", () => {
  for (const variant of emptyVariants) {
    render(
      <EmptyState
        label="Nothing has run"
        variant={variant}
        detail="A dispatch starts it"
        action={<span>Dispatch</span>}
      />,
    );
    expect(screen.getByText("Nothing has run")).toBeDefined();
    expect(
      screen.queryByRole("heading", { name: "Nothing has run" }) !== null,
    ).toBe(variant === "page");
    cleanup();
  }
});

test("a table scrolls itself and names its columns", () => {
  const { container } = render(
    <Table caption="Usage by model">
      <thead>
        <tr>
          <th scope="col">Model</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row">claude-opus-4</th>
        </tr>
      </tbody>
    </Table>,
  );
  expect(container.querySelector(".table-scroll")).not.toBeNull();
  expect(screen.getByRole("table", { name: "Usage by model" })).toBeDefined();
  expect(
    screen.getByRole("rowheader", { name: "claude-opus-4" }),
  ).toBeDefined();
});

test("a section list is anchors, with a figure or a note and never both invented", () => {
  const { container } = render(
    <SectionList
      entries={[
        { id: "cycles", label: "Cycles", note: "3 · 7 runs" },
        {
          id: "usage",
          label: "Usage",
          figure: { kind: "Cost", text: "$2.74", basis: "list" },
        },
        { id: "brief", label: "Brief" },
      ]}
    />,
  );
  const links = container.querySelectorAll("nav a");
  expect(links).toHaveLength(3);
  expect(links[0]?.getAttribute("href")).toBe("#cycles");
  expect(screen.getByText("3 · 7 runs")).toBeDefined();
  expect(screen.getByText("$2.74")).toBeDefined();
  expect(links[2]?.textContent).toBe("Brief");
});
