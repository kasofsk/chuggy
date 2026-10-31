/**
 * The revision a catalog ticket follows, chosen behind the creation and edit
 * forms' Advanced disclosure: the catalog's default is shown as the choice of
 * none, and a choice is kept as made even where it equals that default.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { TicketCreationAdvanced } from "../app/browser/TicketCreationAdvanced.tsx";
import type { TicketCreationForm } from "../app/core/ticketCreation.ts";
import { creationFormFrom } from "../app/core/ticketCreation.ts";
import {
  creationCatalogCanonical,
  creationCatalogOffer,
  creationOffers,
} from "./ticketCreationFixture.ts";

afterEach(() => {
  cleanup();
});

function offerFollowing(defaulted: string | undefined) {
  const offer = creationCatalogOffer();
  const parsed = JSON.parse(creationCatalogCanonical) as {
    readonly defaults: object;
  };
  const canonical =
    defaulted === undefined
      ? creationCatalogCanonical
      : JSON.stringify({
          ...parsed,
          defaults: { ...parsed.defaults, configuration: defaulted },
        });
  return {
    ...offer,
    initialization: {
      ...offer.initialization,
      configuration: { ...offer.initialization.configuration, canonical },
    },
  };
}

function drawn(defaulted: string | undefined, form?: TicketCreationForm) {
  const offer = offerFollowing(defaulted);
  const onChange = vi.fn<(form: TicketCreationForm) => void>();
  render(
    <TicketCreationAdvanced
      form={form ?? creationFormFrom([offer], [])}
      onChange={onChange}
      initialization={offer.initialization}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
  return {
    picker: screen.getByLabelText<HTMLSelectElement>("Configuration version"),
    onChange,
  };
}

test("the picker shows the catalog's default as the choice of none, beside Pinned and Latest", () => {
  for (const [defaulted, shown] of [
    [undefined, "Default (Pinned)"],
    ["Latest", "Default (Latest)"],
  ] as const) {
    const { picker } = drawn(defaulted);
    expect(picker.value).toBe(shown);
    expect([...picker.options].map((option) => option.value)).toStrictEqual([
      shown,
      "Pinned",
      "Latest",
    ]);
    cleanup();
  }
});

test("a revision chosen is held as chosen, the default's own among them, and the default chosen holds none", () => {
  const { picker, onChange } = drawn("Latest");
  fireEvent.change(picker, { target: { value: "Latest" } });
  expect(onChange.mock.lastCall?.[0].selection).toStrictEqual({
    configuration: "Latest",
  });
  cleanup();
  const offer = offerFollowing("Latest");
  const chosen = {
    ...creationFormFrom([offer], []),
    selection: { work: "quick", configuration: "Pinned" as const },
  };
  const held = drawn("Latest", chosen);
  expect(held.picker.value).toBe("Pinned");
  fireEvent.change(held.picker, { target: { value: "Default (Latest)" } });
  expect(held.onChange.mock.lastCall?.[0].selection).toStrictEqual({
    work: "quick",
  });
});

test("a configuration that is no catalog offers no version", () => {
  const [offer] = creationOffers;
  if (offer === undefined) throw new Error("no offer");
  render(
    <TicketCreationAdvanced
      form={creationFormFrom([offer], [])}
      onChange={() => undefined}
      initialization={offer.initialization}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
  expect(screen.queryByLabelText("Configuration version")).toBeNull();
});
