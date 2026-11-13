/**
 * The button over its two rosters, and the three states it carries as
 * attributes rather than as classes.
 *
 * The attributes are what the assertions read, because they are what a reader's
 * assistive technology is told; the router is stubbed so the link variant is
 * drawn with no provider around it.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import {
  Button,
  ButtonLink,
  buttonSizes,
  buttonVariants,
} from "../app/browser/ui/Button.tsx";
import buttonSheet from "../app/browser/ui/Button.css?raw";
import menuSheet from "../app/browser/ui/Menu.css?raw";
import radioSheet from "../app/browser/ui/RadioGroup.css?raw";
import { sheetDeclared, sheetRules } from "./sheet.ts";
import { styleless } from "./styleless.ts";

interface LinkStub {
  readonly className?: string;
  readonly children?: ReactNode;
}

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: (props: LinkStub) => ReactNode) => component,
}));

afterEach(cleanup);

const sizeClassNames = {
  md: "text-md",
  sm: "text-sm",
  icon: "btn-icon",
} as const satisfies Record<(typeof buttonSizes)[number], string>;

test("every variant and size draws its own class", () => {
  for (const variant of buttonVariants)
    for (const size of buttonSizes) {
      render(
        <Button variant={variant} size={size} onClick={() => undefined}>
          {`${variant} ${size}`}
        </Button>,
      );
      const drawn = screen.getByRole("button");
      expect(drawn.classList.contains(`btn-${variant}`)).toBe(true);
      expect(drawn.classList.contains(sizeClassNames[size])).toBe(true);
      expect(drawn.classList.contains("rounded-3")).toBe(true);
      styleless();
      cleanup();
    }
});

test("a press reaches the caller, and a disabled button does not", () => {
  let presses = 0;
  const { rerender } = render(
    <Button
      onClick={() => {
        presses += 1;
      }}
    >
      Resume
    </Button>,
  );
  fireEvent.click(screen.getByRole("button"));
  rerender(
    <Button
      disabled
      onClick={() => {
        presses += 1;
      }}
    >
      Resume
    </Button>,
  );
  fireEvent.click(screen.getByRole("button"));
  expect(presses).toBe(1);
  styleless();
});

test("pressed and busy are attributes, and the default type is not submit", () => {
  const view = render(
    <Button pressed busy onClick={() => undefined}>
      Dark
    </Button>,
  );
  const drawn = screen.getByRole("button");
  expect(drawn.getAttribute("aria-pressed")).toBe("true");
  expect(drawn.getAttribute("aria-busy")).toBe("true");
  expect(drawn.getAttribute("type")).toBe("button");
  expect(view.container.querySelector("[style]")).toBeNull();
  styleless();
});

test("a form's button submits it and nothing else, and a disabled one does not", () => {
  let submissions = 0;
  const form = (disabled: boolean): ReactNode => (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submissions += 1;
      }}
    >
      <Button type="submit" disabled={disabled}>
        Create
      </Button>
    </form>
  );
  const { rerender } = render(form(false));
  expect(screen.getByRole("button").getAttribute("type")).toBe("submit");
  fireEvent.click(screen.getByRole("button"));
  expect(submissions).toBe(1);
  rerender(form(true));
  fireEvent.click(screen.getByRole("button"));
  expect(submissions).toBe(1);
  styleless();
});

test("a link is drawn with the button's own look, and no style attribute", () => {
  const view = render(<ButtonLink to="/">New ticket</ButtonLink>);
  const drawn = view.container.querySelector("a");
  expect(drawn?.textContent).toBe("New ticket");
  expect(drawn?.classList.contains("btn")).toBe(true);
  expect(drawn?.classList.contains("btn-default")).toBe(true);
  expect(view.container.querySelector("[style]")).toBeNull();
  styleless();
});

const buttonCoarse = ["(pointer: coarse)"];

/** What the button sheet declares for the one button on screen. */
function buttonDeclared(
  property: string,
  conditions: readonly string[] = [],
): string {
  return sheetDeclared(
    sheetRules(buttonSheet, conditions),
    screen.getByRole("button"),
    property,
  );
}

/** The weight utilities on an element's class string. The utilities layer
 * follows `ui`, so one of these would win over any weight the sheet declares. */
function weightUtilities(element: Element): readonly string[] {
  return Array.from(element.classList).filter((name) =>
    /^font-(regular|medium|strong)$/.test(name),
  );
}

test("a pressed toggle is told from the primary by its attribute and its weight, not by colour alone", () => {
  render(
    <Button pressed onClick={() => undefined}>
      Chain
    </Button>,
  );
  const pressed = screen.getByRole("button");
  expect(pressed.getAttribute("aria-pressed")).toBe("true");
  expect(pressed.classList.contains("btn-primary")).toBe(false);
  expect(weightUtilities(pressed)).toEqual([]);
  expect(buttonDeclared("font-weight")).toBe("var(--weight-strong)");
  expect(buttonDeclared("background")).toBe("var(--wash-accent)");
  expect(buttonDeclared("border-color")).toBe("var(--accent)");
  cleanup();
  render(
    <Button variant="primary" onClick={() => undefined}>
      Create
    </Button>,
  );
  expect(screen.getByRole("button").hasAttribute("aria-pressed")).toBe(false);
  expect(buttonDeclared("font-weight")).toBe("var(--weight-medium)");
  expect(buttonDeclared("background")).toBe("var(--accent)");
  expect(buttonDeclared("color")).toBe("var(--ink-on-accent)");
  styleless();
});

test("the confirming danger is a class of its own and filled, and the entry point's stays text", () => {
  render(
    <Button variant="danger" onClick={() => undefined}>
      Delete
    </Button>,
  );
  expect(screen.getByRole("button").classList.contains("btn-danger")).toBe(
    true,
  );
  expect(buttonDeclared("background")).toBe("transparent");
  expect(buttonDeclared("color")).toBe("var(--tone-fail)");
  cleanup();
  render(
    <Button variant="danger-filled" onClick={() => undefined}>
      Delete
    </Button>,
  );
  const filled = screen.getByRole("button");
  expect(filled.classList.contains("btn-danger-filled")).toBe(true);
  expect(filled.classList.contains("btn-danger")).toBe(false);
  expect(buttonDeclared("background")).toBe("var(--tone-fail)");
  expect(buttonDeclared("color")).toBe("var(--tone-on-danger)");
  styleless();
});

test("a disabled filled button gives up its fill for the disabled text and edge", () => {
  for (const variant of ["primary", "danger-filled"] as const) {
    render(
      <Button variant={variant} disabled onClick={() => undefined}>
        Delete
      </Button>,
    );
    const rules = sheetRules(buttonSheet, []).filter((rule) =>
      rule.selectorText.includes(":disabled"),
    );
    const drawn = screen.getByRole("button");
    expect(sheetDeclared(rules, drawn, "background")).toBe("transparent");
    expect(sheetDeclared(rules, drawn, "color")).toBe("var(--ink-3)");
    expect(sheetDeclared(rules, drawn, "border-color")).toBe(
      "var(--edge-strong)",
    );
    cleanup();
  }
});

test("every size is a control's height under a coarse pointer, and unchanged otherwise", () => {
  for (const size of buttonSizes) {
    render(
      <Button size={size} onClick={() => undefined}>
        Go
      </Button>,
    );
    expect(buttonDeclared("min-height")).toBe("");
    expect(buttonDeclared("min-height", buttonCoarse)).toBe(
      "var(--height-control)",
    );
    if (size === "icon")
      for (const side of ["width", "height"]) {
        expect(buttonDeclared(side)).toBe("var(--height-icon)");
        expect(buttonDeclared(side, buttonCoarse)).toBe(
          "var(--height-control)",
        );
      }
    cleanup();
  }
});

test("a menu item is a control's height under a coarse pointer, and unchanged otherwise", () => {
  const item = document.createElement("div");
  item.className = "menu-item";
  expect(sheetDeclared(sheetRules(menuSheet, []), item, "min-height")).toBe("");
  expect(
    sheetDeclared(sheetRules(menuSheet, buttonCoarse), item, "min-height"),
  ).toBe("var(--height-control)");
});

test("a radio keeps its drawn size and is pressed through a control's height under a coarse pointer", () => {
  const area = (conditions: readonly string[]): CSSStyleRule | undefined =>
    sheetRules(radioSheet, conditions).find(
      (rule) => rule.selectorText === ".radio-item::after",
    );
  expect(area([])).toBeUndefined();
  const coarse = area(buttonCoarse);
  expect(coarse?.style.getPropertyValue("height")).toBe(
    "var(--height-control)",
  );
  expect(coarse?.style.getPropertyValue("width")).toBe("var(--height-control)");
  expect(coarse?.style.getPropertyValue("position")).toBe("absolute");
  const item = document.createElement("button");
  item.className = "radio-item";
  for (const conditions of [[], buttonCoarse])
    expect(
      sheetDeclared(sheetRules(radioSheet, conditions), item, "height"),
    ).toBe("1em");
});
