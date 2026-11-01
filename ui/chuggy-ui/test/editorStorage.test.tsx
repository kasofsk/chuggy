/**
 * What the ticket editor keeps in the browser: the vim preference and each
 * screen's YAML, under the keys an author's earlier visits wrote, and a store
 * that refuses costing the copy and nothing on screen.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  ticketConfigurationKept,
  ticketConfigurationStored,
  ticketYamlForgotten,
  ticketYamlImagesKept,
  ticketYamlImagesStored,
  ticketYamlKept,
  ticketYamlStored,
  ticketYamlStoreKey,
} from "../app/browser/editor/authoringGuards.tsx";
import TicketEditor from "../app/browser/editor/TicketEditor.tsx";

const atlas = { tenant: "acme", project: "atlas" };

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

/** Every write and removal the browser's storage is asked for refused. */
function storeRefusing(): void {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("quota", "QuotaExceededError");
  });
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new DOMException("denied", "SecurityError");
  });
}

function editorDrawn(): HTMLInputElement {
  render(
    <TicketEditor
      value={"title: x\n"}
      onChange={() => undefined}
      problems={[]}
      vocabulary={[]}
      catalog={undefined}
    />,
  );
  return screen.getByRole<HTMLInputElement>("checkbox", { name: "Vim keys" });
}

test("the vim preference is kept under the key it always was, and read back", () => {
  fireEvent.click(editorDrawn());
  expect(localStorage.getItem("chug.editor.vim")).toBe("true");
  cleanup();
  expect(editorDrawn().checked).toBe(true);
});

test("a vim preference the store refuses is still applied", () => {
  storeRefusing();
  const vim = editorDrawn();
  fireEvent.click(vim);
  expect(vim.checked).toBe(true);
});

test("a screen's YAML, its images and its configuration keep the keys they always had", () => {
  const key = ticketYamlStoreKey(atlas, undefined);
  ticketYamlKept(key, "title: kept\n");
  ticketYamlImagesKept(key, ["image-1"]);
  ticketConfigurationKept(atlas, "chuggy-development");
  expect(localStorage.getItem("chug.ticket-yaml.acme/atlas/new")).toBe(
    "title: kept\n",
  );
  expect(localStorage.getItem("chug.ticket-yaml.acme/atlas/new.images")).toBe(
    '["image-1"]',
  );
  expect(localStorage.getItem("chug.ticket-configuration.acme/atlas")).toBe(
    "chuggy-development",
  );
  expect(ticketYamlStored(key)).toBe("title: kept\n");
  expect(ticketYamlImagesStored(key)).toStrictEqual(["image-1"]);
  expect(ticketConfigurationStored(atlas)).toBe("chuggy-development");

  ticketYamlForgotten(key);
  expect(ticketYamlStored(key)).toBeUndefined();
  expect(ticketYamlImagesStored(key)).toStrictEqual([]);
});

test("a store that refuses costs the copy and throws at no caller", () => {
  const key = ticketYamlStoreKey(atlas, 7);
  localStorage.setItem(key, "title: before\n");
  storeRefusing();
  expect(() => {
    ticketYamlKept(key, "title: after\n");
    ticketYamlForgotten(key);
  }).not.toThrow();
  expect(ticketYamlStored(key)).toBe("title: before\n");
});
