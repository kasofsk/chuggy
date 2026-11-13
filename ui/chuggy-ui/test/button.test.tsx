/**
 * The button over its two rosters, and the three states it carries as
 * attributes rather than as classes.
 *
 * The paint is read from `Button.css` rule by rule, so a pressed toggle, the
 * primary action and the two dangers are told apart by what the sheet and the
 * class string say rather than by a colour a suite cannot see.
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
import { sheetDeclared, sheetRules } from "./sheet.ts";
import { styleless } from "./styleless.ts";

const buttonCoarseCondition = "(pointer: coarse)";

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

test("a pressed toggle is a wash and a heavier word, and the primary action a fill of the accent", () => {
  render(
    <>
      <Button variant="primary" onClick={() => undefined}>
        Create
      </Button>
      <Button pressed onClick={() => undefined}>
        Dark
      </Button>
    </>,
  );
  const rules = sheetRules(buttonSheet, []);
  const primary = screen.getByRole("button", { name: "Create" });
  const toggle = screen.getByRole("button", { name: "Dark" });
  expect(sheetDeclared(rules, primary, "background")).toBe("var(--accent)");
  expect(sheetDeclared(rules, primary, "color")).toBe("var(--ink-on-accent)");
  expect(primary.hasAttribute("aria-pressed")).toBe(false);
  expect(toggle.getAttribute("aria-pressed")).toBe("true");
  expect(toggle.classList.contains("aria-pressed:font-strong")).toBe(true);
  expect(sheetDeclared(rules, toggle, "background")).toBe("var(--wash-accent)");
  expect(sheetDeclared(rules, toggle, "color")).toBe("var(--ink-1)");
  styleless();
});

test("a destructive entry is quiet until it is reached, and its confirmation is filled", () => {
  render(
    <>
      <Button variant="danger" onClick={() => undefined}>
        Delete
      </Button>
      <Button variant="danger-filled" onClick={() => undefined}>
        Delete ticket
      </Button>
    </>,
  );
  const rules = sheetRules(buttonSheet, []);
  const entry = screen.getByRole("button", { name: "Delete" });
  const confirmation = screen.getByRole("button", { name: "Delete ticket" });
  expect(entry.classList.contains("btn-danger")).toBe(true);
  expect(entry.classList.contains("btn-danger-filled")).toBe(false);
  expect(confirmation.classList.contains("btn-danger-filled")).toBe(true);
  expect(confirmation.classList.contains("btn-danger")).toBe(false);
  expect(sheetDeclared(rules, entry, "background")).toBe("transparent");
  expect(sheetDeclared(rules, confirmation, "background")).toBe(
    "var(--tone-fail)",
  );
  expect(sheetDeclared(rules, confirmation, "color")).toBe(
    "var(--tone-on-danger)",
  );
  styleless();
});

test("every size is a control's height under a coarse pointer, and its own height otherwise", () => {
  const coarse = sheetRules(buttonSheet, [buttonCoarseCondition]);
  const fine = sheetRules(buttonSheet, []);
  for (const size of buttonSizes) {
    render(
      <Button size={size} onClick={() => undefined}>
        {size}
      </Button>,
    );
    const drawn = screen.getByRole("button");
    expect(sheetDeclared(coarse, drawn, "min-height")).toBe(
      "var(--height-control)",
    );
    expect(sheetDeclared(fine, drawn, "min-height")).toBe("");
    cleanup();
  }
  render(
    <Button size="icon" onClick={() => undefined}>
      +
    </Button>,
  );
  const icon = screen.getByRole("button");
  expect(sheetDeclared(coarse, icon, "min-width")).toBe(
    "var(--height-control)",
  );
  expect(sheetDeclared(fine, icon, "min-width")).toBe("");
});
