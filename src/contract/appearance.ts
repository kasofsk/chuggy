/**
 * What a console theme is: a document of colours for a closed roster of roles,
 * a text-size step and a prose font, the built-in themes, the choice a person
 * or a project makes between them, and the contrast rule a theme is held to.
 *
 * A theme is data and never CSS text. Its colours are strict six-digit hex
 * values for the surfaces, ink, edges and the accent; the machine's state
 * tones and the syntax colours are fixed here rather than themed, so a
 * ticket's state reads the same in every project, and `themeContrastFailures`
 * holds them against each theme's surfaces. The built-in `chuggy` theme is the
 * console's own look, and `test/contract/appearance.test.ts` holds it and the
 * fixed colours to `ui/chuggy-ui/app/styles/tokens.css`.
 */

import { z } from "zod";

import { isBoundedText } from "./http.ts";

export const themeNameCharsMax = 80;

/** The colours a theme sets, each named as the console token it defines. */
export const themeRoles = [
  "surface-0",
  "surface-1",
  "surface-2",
  "surface-inverse",
  "bubble",
  "ink-1",
  "ink-2",
  "ink-3",
  "ink-inverse",
  "edge",
  "edge-strong",
  "edge-control",
  "accent",
  "ink-on-accent",
] as const;
export type ThemeRole = (typeof themeRoles)[number];

/** The colours no theme sets, each named as the console token it defines. */
export const themeFixedRoles = [
  "tone-pass",
  "tone-fail",
  "tone-live",
  "tone-evaluation",
  "tone-finalization",
  "tone-parked",
  "tone-queued",
  "syntax-key",
  "syntax-string",
  "syntax-value",
] as const;
export type ThemeFixedRole = (typeof themeFixedRoles)[number];

export const themeSchemes = ["Light", "Dark"] as const;
export type ThemeScheme = (typeof themeSchemes)[number];

/** The steps of the console's root font size, smallest first. */
export const themeTextSizes = ["Small", "Standard", "Large", "Larger"] as const;
export type ThemeTextSize = (typeof themeTextSizes)[number];

/** The root font size each step sets, as a percentage of the browser's own. */
export const themeTextSizeRootPercents: Readonly<
  Record<ThemeTextSize, number>
> = { Small: 87.5, Standard: 100, Large: 112.5, Larger: 125 };

/** Names the console maps to system font stacks, since it is served with no font source. */
export const themeFonts = ["System", "Humanist", "Serif"] as const;
export type ThemeFont = (typeof themeFonts)[number];

export const themeColourSchema = z.string().regex(/^#[0-9a-f]{6}$/u);

export const themeColoursSchema = z.strictObject(
  Object.fromEntries(themeRoles.map((role) => [role, themeColourSchema])) as {
    readonly [Role in ThemeRole]: typeof themeColourSchema;
  },
);
export type ThemeColours = Readonly<Record<ThemeRole, string>>;

/** Which schemes a theme carries values for, each set complete. */
export const themePaletteSchema = z.discriminatedUnion("schemes", [
  z.strictObject({ schemes: z.literal("Light"), light: themeColoursSchema }),
  z.strictObject({ schemes: z.literal("Dark"), dark: themeColoursSchema }),
  z.strictObject({
    schemes: z.literal("Both"),
    light: themeColoursSchema,
    dark: themeColoursSchema,
  }),
]);
export type ThemePalette = z.infer<typeof themePaletteSchema>;

export const themeNameSchema = z
  .string()
  .refine(
    (name) => name.trim() !== "" && isBoundedText(name, themeNameCharsMax),
  );

export const themeDocumentSchema = z.strictObject({
  name: themeNameSchema,
  palette: themePaletteSchema,
  textSize: z.enum(themeTextSizes),
  font: z.enum(themeFonts),
});
export type ThemeDocument = z.infer<typeof themeDocumentSchema>;

export const builtInThemeIds = [
  "chuggy",
  "harbour",
  "ember",
  "high-contrast",
] as const;
export type BuiltInThemeId = (typeof builtInThemeIds)[number];

/** A theme a person or a project chooses: a built-in by its id, or a document a person owns by its number. */
export const themeChoiceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("BuiltIn"),
    theme: z.enum(builtInThemeIds),
  }),
  z.strictObject({
    kind: z.literal("Owned"),
    theme: z.number().int().min(1).safe(),
  }),
]);
export type ThemeChoice = z.infer<typeof themeChoiceSchema>;

/** The least contrast text needs against the ground it is drawn on. */
export const themeContrastTextMin = 4.5;

/** The least contrast a mark that is not text needs against its ground. */
export const themeContrastMarkMin = 3;

export const themeFixedColours: Readonly<
  Record<ThemeScheme, Readonly<Record<ThemeFixedRole, string>>>
> = {
  Light: {
    "tone-pass": "#27743f",
    "tone-fail": "#b3342c",
    "tone-live": "#1b65a0",
    "tone-evaluation": "#7550ac",
    "tone-finalization": "#167365",
    "tone-parked": "#885600",
    "tone-queued": "#59665e",
    "syntax-key": "#3658c7",
    "syntax-string": "#25664b",
    "syntax-value": "#80489b",
  },
  Dark: {
    "tone-pass": "#79c68f",
    "tone-fail": "#f08880",
    "tone-live": "#74b7f0",
    "tone-evaluation": "#b9a0ee",
    "tone-finalization": "#68cbb6",
    "tone-parked": "#efb85b",
    "tone-queued": "#a4aca6",
    "syntax-key": "#93a9f2",
    "syntax-string": "#6fbf95",
    "syntax-value": "#c79ae0",
  },
};

export const builtInThemes: Readonly<Record<BuiltInThemeId, ThemeDocument>> = {
  chuggy: {
    name: "Chuggy",
    palette: {
      schemes: "Both",
      light: {
        "surface-0": "#edf0ea",
        "surface-1": "#f7f8f5",
        "surface-2": "#e2e6de",
        "surface-inverse": "#151a17",
        bubble: "#dfe5da",
        "ink-1": "#151a17",
        "ink-2": "#2b332e",
        "ink-3": "#5b665f",
        "ink-inverse": "#f7f8f5",
        edge: "#cdd4ca",
        "edge-strong": "#848c85",
        "edge-control": "#6f7a72",
        accent: "#151a17",
        "ink-on-accent": "#f7f8f5",
      },
      dark: {
        "surface-0": "#0e1210",
        "surface-1": "#151a17",
        "surface-2": "#0a0d0b",
        "surface-inverse": "#eef2ee",
        bubble: "#1b221d",
        "ink-1": "#eef2ee",
        "ink-2": "#c9d1cb",
        "ink-3": "#8a948c",
        "ink-inverse": "#0e1210",
        edge: "#262d28",
        "edge-strong": "#5f6761",
        "edge-control": "#66716a",
        accent: "#eef2ee",
        "ink-on-accent": "#0e1210",
      },
    },
    textSize: "Standard",
    font: "System",
  },
  harbour: {
    name: "Harbour",
    palette: {
      schemes: "Both",
      light: {
        "surface-0": "#ebeff3",
        "surface-1": "#f6f8fa",
        "surface-2": "#dfe5eb",
        "surface-inverse": "#14202b",
        bubble: "#dce5ee",
        "ink-1": "#121c26",
        "ink-2": "#283642",
        "ink-3": "#56636f",
        "ink-inverse": "#f6f8fa",
        edge: "#c9d3dc",
        "edge-strong": "#9aa7b3",
        "edge-control": "#6b7884",
        accent: "#1f5f99",
        "ink-on-accent": "#ffffff",
      },
      dark: {
        "surface-0": "#0d1218",
        "surface-1": "#141b23",
        "surface-2": "#090d12",
        "surface-inverse": "#e9eff5",
        bubble: "#1a2430",
        "ink-1": "#e9eff5",
        "ink-2": "#c3ceda",
        "ink-3": "#8794a1",
        "ink-inverse": "#0d1218",
        edge: "#232d38",
        "edge-strong": "#3a4652",
        "edge-control": "#6c7986",
        accent: "#7ab4ea",
        "ink-on-accent": "#0d1218",
      },
    },
    textSize: "Standard",
    font: "System",
  },
  ember: {
    name: "Ember",
    palette: {
      schemes: "Both",
      light: {
        "surface-0": "#f2eee8",
        "surface-1": "#faf8f4",
        "surface-2": "#e8e2d9",
        "surface-inverse": "#221a14",
        bubble: "#e9e0d4",
        "ink-1": "#1f1813",
        "ink-2": "#3a302a",
        "ink-3": "#67594f",
        "ink-inverse": "#faf8f4",
        edge: "#d8cfc4",
        "edge-strong": "#ab9f92",
        "edge-control": "#7d7064",
        accent: "#a8452a",
        "ink-on-accent": "#ffffff",
      },
      dark: {
        "surface-0": "#13100e",
        "surface-1": "#1b1714",
        "surface-2": "#0e0b0a",
        "surface-inverse": "#f3ede6",
        bubble: "#261f1a",
        "ink-1": "#f3ede6",
        "ink-2": "#d6ccc2",
        "ink-3": "#9a8e83",
        "ink-inverse": "#13100e",
        edge: "#2e2722",
        "edge-strong": "#473d36",
        "edge-control": "#7a6e64",
        accent: "#f0936f",
        "ink-on-accent": "#13100e",
      },
    },
    textSize: "Standard",
    font: "Humanist",
  },
  "high-contrast": {
    name: "High contrast",
    palette: {
      schemes: "Both",
      light: {
        "surface-0": "#ffffff",
        "surface-1": "#ffffff",
        "surface-2": "#f0f0f0",
        "surface-inverse": "#000000",
        bubble: "#ebebeb",
        "ink-1": "#000000",
        "ink-2": "#1a1a1a",
        "ink-3": "#3d3d3d",
        "ink-inverse": "#ffffff",
        edge: "#8a8a8a",
        "edge-strong": "#4d4d4d",
        "edge-control": "#3d3d3d",
        accent: "#0b4f8a",
        "ink-on-accent": "#ffffff",
      },
      dark: {
        "surface-0": "#000000",
        "surface-1": "#0a0a0a",
        "surface-2": "#141414",
        "surface-inverse": "#ffffff",
        bubble: "#1f1f1f",
        "ink-1": "#ffffff",
        "ink-2": "#e6e6e6",
        "ink-3": "#c2c2c2",
        "ink-inverse": "#000000",
        edge: "#767676",
        "edge-strong": "#b3b3b3",
        "edge-control": "#c2c2c2",
        accent: "#8cc8ff",
        "ink-on-accent": "#000000",
      },
    },
    textSize: "Large",
    font: "System",
  },
};

function contrastLuminanceChannel(byte: number): number {
  const channel = byte / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

/** A colour's relative luminance by the WCAG definition, from black at zero to white at one. */
export function contrastLuminance(colour: string): number {
  const parsed = themeColourSchema.parse(colour);
  const [red, green, blue] = [1, 3, 5].map((start) =>
    contrastLuminanceChannel(
      Number.parseInt(parsed.slice(start, start + 2), 16),
    ),
  ) as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** The WCAG contrast ratio of two colours, the same whichever is given first. */
export function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [
    contrastLuminance(first),
    contrastLuminance(second),
  ].sort((left, right) => right - left) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

type ThemeContrastRole = ThemeRole | ThemeFixedRole;

/** The grounds a filled state label draws inverse ink on, each named as the console token it defines. */
export const themeFills = [
  "fill-pass",
  "fill-live",
  "fill-evaluation",
  "fill-finalization",
  "fill-parked",
] as const;
export type ThemeFill = (typeof themeFills)[number];

const themeFillTones: Readonly<Record<ThemeFill, ThemeFixedRole>> = {
  "fill-pass": "tone-pass",
  "fill-live": "tone-live",
  "fill-evaluation": "tone-evaluation",
  "fill-finalization": "tone-finalization",
  "fill-parked": "tone-parked",
};

/** How much of its tone a fill keeps in the dark scheme, the rest being the theme's `surface-0`. */
export const themeFillDarkPercent = 78;

/** Two colours mixed channel by channel in sRGB, as CSS `color-mix(in srgb, ...)` mixes them. */
export function themeColourMix(
  first: string,
  second: string,
  firstPercent: number,
): string {
  const [one, two] = [first, second].map((colour) =>
    themeColourSchema.parse(colour),
  ) as [string, string];
  const channels = [1, 3, 5].map((start) => {
    const [left, right] = [one, two].map((colour) =>
      Number.parseInt(colour.slice(start, start + 2), 16),
    ) as [number, number];
    const mixed = (left * firstPercent + right * (100 - firstPercent)) / 100;
    return Math.round(mixed).toString(16).padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

/** The colour a fill is in one scheme of a theme: its tone in light, the tone mixed with the page in dark. */
export function themeFillColour(
  scheme: ThemeScheme,
  colours: ThemeColours,
  fill: ThemeFill,
): string {
  const tone = themeFixedColours[scheme][themeFillTones[fill]];
  switch (scheme) {
    case "Light":
      return tone;
    case "Dark":
      return themeColourMix(tone, colours["surface-0"], themeFillDarkPercent);
  }
}

/** The grounds a notice or a state's row is washed in, each named as the console token it defines. */
export const themeWashes = [
  "wash-pass",
  "wash-fail",
  "wash-live",
  "wash-evaluation",
  "wash-finalization",
  "wash-parked",
  "wash-queued",
] as const;
export type ThemeWash = (typeof themeWashes)[number];

const themeWashTones: Readonly<Record<ThemeWash, ThemeFixedRole>> = {
  "wash-pass": "tone-pass",
  "wash-fail": "tone-fail",
  "wash-live": "tone-live",
  "wash-evaluation": "tone-evaluation",
  "wash-finalization": "tone-finalization",
  "wash-parked": "tone-parked",
  "wash-queued": "tone-queued",
};

/** How much of its tone a wash keeps, the rest being the theme's `surface-1`. */
export const themeWashPercent = 10;

/** The colour a wash is in one scheme of a theme: its tone mixed with the theme's `surface-1`. */
export function themeWashColour(
  scheme: ThemeScheme,
  colours: ThemeColours,
  wash: ThemeWash,
): string {
  return themeColourMix(
    themeFixedColours[scheme][themeWashTones[wash]],
    colours["surface-1"],
    themeWashPercent,
  );
}

type ThemeContrastGround = ThemeRole | ThemeFill | ThemeWash;

/** One colour drawn on one ground, and the least contrast it needs there. */
export interface ThemeContrastPair {
  readonly foreground: ThemeContrastRole;
  readonly background: ThemeContrastGround;
  readonly ratioMin: number;
}

function themeContrastPairsOf(
  foregrounds: readonly ThemeContrastRole[],
  backgrounds: readonly ThemeContrastGround[],
  ratioMin: number,
): ThemeContrastPair[] {
  return foregrounds.flatMap((foreground) =>
    backgrounds.map((background) => ({ foreground, background, ratioMin })),
  );
}

const themeTones = themeFixedRoles.filter((role) => role.startsWith("tone-"));
const themeSyntax = themeFixedRoles.filter((role) =>
  role.startsWith("syntax-"),
);

/**
 * The pairs `themeContrastFailures` reads: ink on the surfaces, the bubble and
 * the washes; inverse ink on the inverse surface and the fills; the accent's
 * ink on the accent; syntax on the code surfaces; the control edge, the accent
 * and the inverse surface as marks on the page and a panel; and a state's tone,
 * printed as its word, as text on the page, a panel and its own wash and as a
 * mark on the sunken surface. Left out are `edge` and `edge-strong` on any
 * surface, which built-in themes draw below the minimum, the inverse ink on the
 * retired fill and the context's slots, which the console's own look draws
 * below it, and the inverse ink on a button's hover, a mix the console owns
 * rather than a ground named here.
 */
export const themeContrastPairs: readonly ThemeContrastPair[] = [
  ...themeContrastPairsOf(
    ["ink-1", "ink-2", "ink-3"],
    ["surface-0", "surface-1", "surface-2", "bubble"],
    themeContrastTextMin,
  ),
  ...themeContrastPairsOf(
    ["ink-1", "ink-2", "ink-3"],
    themeWashes,
    themeContrastTextMin,
  ),
  ...themeContrastPairsOf(
    ["ink-inverse"],
    ["surface-inverse", ...themeFills],
    themeContrastTextMin,
  ),
  ...themeContrastPairsOf(["ink-on-accent"], ["accent"], themeContrastTextMin),
  ...themeContrastPairsOf(
    themeSyntax,
    ["surface-1", "surface-2"],
    themeContrastTextMin,
  ),
  ...themeContrastPairsOf(
    ["edge-control", "accent", "surface-inverse"],
    ["surface-0", "surface-1"],
    themeContrastMarkMin,
  ),
  ...themeContrastPairsOf(
    themeTones,
    ["surface-0", "surface-1"],
    themeContrastTextMin,
  ),
  ...themeContrastPairsOf(themeTones, ["surface-2"], themeContrastMarkMin),
  ...themeWashes.map((wash) => ({
    foreground: themeWashTones[wash],
    background: wash,
    ratioMin: themeContrastTextMin,
  })),
];

/** A pair a theme draws below the contrast it needs, in one scheme. */
export interface ThemeContrastFailure extends ThemeContrastPair {
  readonly scheme: ThemeScheme;
  readonly ratio: number;
}

/** The schemes a palette carries, each with its colours. */
export function themePaletteSchemes(
  palette: ThemePalette,
): readonly (readonly [ThemeScheme, ThemeColours])[] {
  switch (palette.schemes) {
    case "Light":
      return [["Light", palette.light]];
    case "Dark":
      return [["Dark", palette.dark]];
    case "Both":
      return [
        ["Light", palette.light],
        ["Dark", palette.dark],
      ];
  }
}

/** Every pair a theme draws below the contrast it needs, in every scheme it carries; none is a theme that passes. */
export function themeContrastFailures(
  theme: ThemeDocument,
): readonly ThemeContrastFailure[] {
  return themePaletteSchemes(theme.palette).flatMap(([scheme, colours]) => {
    const fixed = themeFixedColours[scheme];
    const colourOf = (role: ThemeContrastRole | ThemeContrastGround): string =>
      role in colours
        ? colours[role as ThemeRole]
        : role in themeFillTones
          ? themeFillColour(scheme, colours, role as ThemeFill)
          : role in themeWashTones
            ? themeWashColour(scheme, colours, role as ThemeWash)
            : fixed[role as ThemeFixedRole];
    return themeContrastPairs.flatMap((pair) => {
      const ratio = contrastRatio(
        colourOf(pair.foreground),
        colourOf(pair.background),
      );
      return ratio < pair.ratioMin ? [{ ...pair, scheme, ratio }] : [];
    });
  });
}
