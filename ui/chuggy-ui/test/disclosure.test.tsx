/**
 * The disclosure: a trigger naming the body it shows, the body mounted only
 * while open, and no style element appended for the served policy to refuse.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { useState } from "react";
import type { ReactNode } from "react";

import { Disclosure } from "../app/browser/ui/Disclosure.tsx";

function Held(): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <Disclosure
      open={open}
      onOpenChange={setOpen}
      label={open ? "hide" : "show"}
    >
      <pre>canonical</pre>
    </Disclosure>
  );
}

afterEach(cleanup);

test("the trigger names the body, which mounts only while open", () => {
  const view = render(<Held />);
  const trigger = screen.getByRole("button", { name: "show" });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("canonical")).toBeNull();
  fireEvent.click(trigger);
  const body = screen.getByText("canonical");
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(trigger.getAttribute("aria-controls")).toBe(body.id);
  expect(screen.getByRole("button", { name: "hide" })).toBe(trigger);
  expect(document.querySelectorAll("style")).toHaveLength(0);
  fireEvent.click(trigger);
  expect(screen.queryByText("canonical")).toBeNull();
  expect(view.container.querySelectorAll("button[style]")).toHaveLength(0);
});
