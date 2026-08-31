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

interface LinkStub {
  readonly className?: string;
  readonly children?: ReactNode;
}

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: (props: LinkStub) => ReactNode) => component,
}));

afterEach(cleanup);

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
      expect(drawn.classList.contains("btn-sm")).toBe(size === "sm");
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
});

test("a link is drawn with the button's own look, and no style attribute", () => {
  const view = render(<ButtonLink to="/">New ticket</ButtonLink>);
  const drawn = view.container.querySelector("a");
  expect(drawn?.textContent).toBe("New ticket");
  expect(drawn?.classList.contains("btn")).toBe(true);
  expect(drawn?.classList.contains("btn-default")).toBe(true);
  expect(view.container.querySelector("[style]")).toBeNull();
});
