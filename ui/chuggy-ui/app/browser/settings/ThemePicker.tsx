/**
 * One theme out of a roster, each a card showing the theme's surface, ink and
 * accent in the scheme the page is drawn in now, over Radix's radio group: to
 * the keyboard and to assistive technology it is a radio group, the arrows
 * moving between cards and the theme's name naming each.
 *
 * A card is drawn in its theme by the colour tokens set on its swatch through
 * the object model, which the served policy leaves to script, so its rules
 * are the console's own; the chosen card is marked by a check as well as by
 * its edge. A card may carry no theme, as an option that clears a choice does.
 */

import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";

import type { ThemeDocument } from "../../../../../src/contract/appearance.ts";
import { themeColourAssignmentsOf } from "../../core/themeTokens.ts";

import "./ThemePicker.css";

/** One card: the key it is chosen by, its name, whether that name is data,
 * as a theme's own is, rather than the catalog's, and the theme it shows. */
export interface ThemePickerCard {
  readonly key: string;
  readonly name: string;
  readonly data: boolean;
  readonly theme: ThemeDocument | undefined;
}

function ThemePickerSwatch(props: {
  readonly theme: ThemeDocument;
}): ReactNode {
  const swatch = useRef<HTMLSpanElement>(null);
  const { theme } = props;
  useLayoutEffect(() => {
    const element = swatch.current;
    if (element === null) return;
    for (const { property, value } of themeColourAssignmentsOf(theme))
      element.style.setProperty(property, value);
  }, [theme]);
  return (
    <span ref={swatch} className="theme-swatch" aria-hidden="true">
      <span className="theme-swatch-ink" />
      <span className="theme-swatch-accent" />
    </span>
  );
}

function ThemePickerMark(): ReactNode {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="theme-card-mark">
      <path
        d="M2.5 6.5 L5 9 L9.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ThemePicker(props: {
  readonly label: string;
  readonly value: string;
  readonly cards: readonly ThemePickerCard[];
  /** What describes the group as a whole, such as why its choice is not
   * what the page shows. */
  readonly describedBy?: string | undefined;
  readonly onChoose: (key: string) => void;
}): ReactNode {
  return (
    <RadioGroupPrimitive.Root
      className="theme-picker"
      aria-label={props.label}
      aria-describedby={props.describedBy}
      value={props.value}
      onValueChange={props.onChoose}
    >
      {props.cards.map((card) => (
        <RadioGroupPrimitive.Item
          key={card.key}
          value={card.key}
          className="theme-card"
        >
          {card.theme === undefined ? null : (
            <ThemePickerSwatch theme={card.theme} />
          )}
          <span className="theme-card-name">
            <span className="min-w-0" translate={card.data ? "no" : undefined}>
              {card.name}
            </span>
            <RadioGroupPrimitive.Indicator className="flex">
              <ThemePickerMark />
            </RadioGroupPrimitive.Indicator>
          </span>
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}
