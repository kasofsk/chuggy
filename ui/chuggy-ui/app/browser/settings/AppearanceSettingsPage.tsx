/**
 * A project's appearance, set by its administrators: its default theme, its
 * icon and its banner, each a field of its own whose change saves alone and
 * says so in the shell's toast. A reader the abilities read says does not
 * administer the project is shown the line a reader who can change nothing is.
 *
 * The default theme is chosen in the picker Preferences draws, and kept as
 * `projectAppearance.ts` says. An icon or a banner is a file uploaded as one
 * of the project's artifacts and then named; it is checked against its role's
 * types and bound before anything is sent, and each refusal, the console's or
 * the server's, is the field's error.
 *
 * Each image is previewed as it is drawn, in the project's default theme
 * where it keeps one: the icon at each of its sizes on a light surface and a
 * dark one, named by the project's name; the banner as the band above the
 * tickets at a phone's width and a desk's, drawn as decoration.
 */

import { useParams } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { ThemeDocument } from "../../../../../src/contract/appearance.ts";
import { projectImageMediaTypes } from "../../../../../src/contract/http.ts";
import type {
  PartitionIdentity,
  ProjectImageRole,
} from "../../../../../src/contract/http.ts";
import type {
  ProjectImagesResponse,
  ProjectThemeResponse,
} from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { ApiResult } from "../../core/apiRequest.ts";
import {
  apiUploadProjectArtifact,
  apiWriteProjectImage,
  apiWriteProjectTheme,
} from "../../core/apiRoutes.ts";
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type { ConsoleWrite } from "../../core/consoleWrite.ts";
import type { Copy, CopyText } from "../../core/copy.ts";
import { projectAbilityRefused } from "../../core/projectAbilities.ts";
import {
  projectImageHint,
  projectImageLanded,
  projectImageOffered,
  projectImageRefusalOf,
  projectThemeKept,
  projectThemeLanded,
  projectThemeNone,
  projectThemeRefusalOf,
  projectThemeSettingsOf,
} from "../../core/projectAppearance.ts";
import type {
  ProjectImageMediaType,
  ProjectThemeSettings,
} from "../../core/projectAppearance.ts";
import { projectImagesQuery } from "../../core/projectQueries.ts";
import { projectsInventoryKey } from "../../core/projectQueryKeys.ts";
import { settingsRoutes } from "../../core/settingsNav.ts";
import {
  ownedThemesQuery,
  projectAppearanceQuery,
  projectThemeQuery,
} from "../../core/themeQueries.ts";
import { themePickerOptions } from "../../core/themePreferences.ts";
import type { ThemePickerOption } from "../../core/themePreferences.ts";
import { themeColourAssignmentsOf } from "../../core/themeTokens.ts";
import { usePanelState } from "../api.ts";
import { useConsoleWrite } from "../consoleWrite.tsx";
import { PanelUnready } from "../DataPanel.tsx";
import { useProjectAbilities, ViewOnlyNotice } from "../projectAbilities.tsx";
import { ProjectImage, useProjectImageHeld } from "../ProjectImage.tsx";
import { useProjectNamed } from "../projectNamed.ts";
import { Button } from "../ui/Button.tsx";
import { FormField } from "../ui/FormField.tsx";
import { SettingsPage } from "./SettingsPage.tsx";
import { ThemePicker } from "./ThemePicker.tsx";
import type { ThemePickerCard } from "./ThemePicker.tsx";

import "./AppearanceSettingsPage.css";

function appearanceThemeWrite(
  partition: PartitionIdentity,
): ConsoleWrite<ThemeDocument | undefined, ProjectThemeResponse> {
  return {
    mutationKey: consoleWriteKey(
      "project-theme",
      partition.tenant,
      partition.project,
    ),
    write: (ports, document) =>
      apiWriteProjectTheme(ports, partition, document),
    refusal: projectThemeRefusalOf,
    landed: async (client, written) => {
      client.setQueryData(projectThemeQuery(partition).queryKey, written);
      await client.invalidateQueries({
        queryKey: projectAppearanceQuery(partition).queryKey,
      });
    },
    landedUnseen: (_written, document) => projectThemeLanded(document),
  };
}

/** None, the kept document where no option is it, then every option. */
function appearanceThemeCards(
  text: CopyText,
  settings: ProjectThemeSettings,
  options: readonly ThemePickerOption[],
): readonly ThemePickerCard[] {
  return [
    {
      key: projectThemeNone,
      name: text({ id: "settings-appearance-theme-none" }),
      data: false,
      theme: undefined,
    },
    ...(settings.kept === undefined
      ? []
      : [
          {
            key: projectThemeKept,
            name: text({
              id: "settings-appearance-theme-kept",
              args: { name: settings.kept.name },
            }),
            data: false,
            theme: settings.kept,
          },
        ]),
    ...options.map((option) => ({
      key: option.key,
      name: option.theme.name,
      data: true,
      theme: option.theme,
    })),
  ];
}

/** The line saying the reader's theme has changed since it was kept, and
 * the press that keeps it as it is now. */
function AppearanceThemeDrifted(props: {
  readonly drifted: ThemeDocument;
  readonly busy: boolean;
  readonly onUpdate: () => void;
}): ReactNode {
  const text = useCopyText();
  return (
    <div className="appearance-theme-drifted">
      <p className="text-sm text-ink-2">
        {text({
          id: "settings-appearance-theme-drifted",
          args: { name: props.drifted.name },
        })}
      </p>
      <Button
        size="sm"
        busy={props.busy}
        disabled={props.busy}
        onClick={props.onUpdate}
      >
        {text({ id: "settings-appearance-theme-update" })}
      </Button>
    </div>
  );
}

/** The project's default theme: none, or one of the reader's choices kept as
 * a copy, marked while its write is in flight as the choice pressed. */
function AppearanceTheme(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const text = useCopyText();
  const read = usePanelState(projectThemeQuery(props.partition));
  const owned = usePanelState(ownedThemesQuery());
  const writing = useConsoleWrite(appearanceThemeWrite(props.partition), {
    drawn: true,
  });
  if (read.state !== "Ready") return <PanelUnready state={read} />;
  const options = themePickerOptions(
    owned.state === "Ready" ? owned.value.themes : [],
  );
  const settings = projectThemeSettingsOf(
    writing.isPending ? writing.variables : read.value.document,
    options,
  );
  const label = text({ id: "settings-appearance-theme" });
  const cards = appearanceThemeCards(text, settings, options);
  const drifted = settings.drifted;
  return (
    <FormField
      label={label}
      hint={`${text({ id: "settings-appearance-theme-copied" })} ${text({ id: "settings-appearance-theme-own" })}`}
      {...(writing.error === null ? {} : { error: writing.error.message })}
    >
      {(field) => (
        <div className="appearance-theme">
          <ThemePicker
            label={label}
            value={settings.chosen}
            describedBy={field.describedBy}
            cards={cards}
            onChoose={(key) => {
              if (key === projectThemeNone) {
                writing.mutate(undefined);
                return;
              }
              const option = options.find((held) => held.key === key);
              if (option !== undefined) writing.mutate(option.theme);
            }}
          />
          {drifted === undefined ? null : (
            <AppearanceThemeDrifted
              drifted={drifted.theme}
              busy={writing.isPending}
              onUpdate={() => {
                writing.mutate(drifted.theme);
              }}
            />
          )}
        </div>
      )}
    </FormField>
  );
}

/** A file offered for a role, of a type it takes. */
interface AppearanceImageOffer {
  readonly file: File;
  readonly mediaType: ProjectImageMediaType;
}

/** What an image's write answered: the images as they now stand, and the
 * bytes of one it uploaded, which are that artifact's read. */
interface AppearanceImageWritten {
  readonly images: ProjectImagesResponse;
  readonly uploaded:
    | {
        readonly artifact: string;
        readonly mediaType: ProjectImageMediaType;
        readonly content: Uint8Array<ArrayBuffer>;
      }
    | undefined;
}

/** The file uploaded as one of the project's artifacts and named the role's
 * image, or the role cleared where none is offered. */
function appearanceImageWrite(
  partition: PartitionIdentity,
  role: ProjectImageRole,
  held: ReturnType<typeof useProjectImageHeld>,
): ConsoleWrite<AppearanceImageOffer | undefined, AppearanceImageWritten> {
  return {
    mutationKey: consoleWriteKey(
      "project-image",
      partition.tenant,
      partition.project,
      role,
    ),
    write: async (ports, offer): Promise<ApiResult<AppearanceImageWritten>> => {
      if (offer === undefined) {
        const cleared = await apiWriteProjectImage(
          ports,
          partition,
          role,
          undefined,
        );
        return cleared.outcome === "Ok"
          ? {
              outcome: "Ok",
              value: { images: cleared.value, uploaded: undefined },
            }
          : cleared;
      }
      const content = new Uint8Array(await offer.file.arrayBuffer());
      const upload = await apiUploadProjectArtifact(ports, partition, {
        mediaType: offer.mediaType,
        content,
      });
      if (upload.outcome !== "Ok") return upload;
      const artifact = upload.value.artifact;
      const named = await apiWriteProjectImage(
        ports,
        partition,
        role,
        artifact,
      );
      if (named.outcome !== "Ok") return named;
      return {
        outcome: "Ok",
        value: {
          images: named.value,
          uploaded: { artifact, mediaType: offer.mediaType, content },
        },
      };
    },
    refusal: (failure) => projectImageRefusalOf(role, failure),
    landed: async (client, written) => {
      const uploaded = written.uploaded;
      if (uploaded !== undefined)
        held(uploaded.artifact, uploaded.mediaType, uploaded.content);
      client.setQueryData(
        projectImagesQuery(partition).queryKey,
        written.images,
      );
      await client.invalidateQueries({ queryKey: projectsInventoryKey() });
    },
    landedUnseen: (_written, offer) =>
      projectImageLanded(role, offer !== undefined),
  };
}

const appearanceImageWords = {
  icon: {
    label: "settings-appearance-icon",
    none: "settings-appearance-icon-none",
    choose: "settings-appearance-icon-choose",
    clear: "settings-appearance-icon-clear",
  },
  banner: {
    label: "settings-appearance-banner",
    none: "settings-appearance-banner-none",
    choose: "settings-appearance-banner-choose",
    clear: "settings-appearance-banner-clear",
  },
} as const satisfies Readonly<
  Record<ProjectImageRole, Readonly<Record<string, string>>>
>;

/** A surface drawn in the project's default theme where it keeps one, and in
 * the scheme named where one is. The theme's colours are set through the
 * object model, which the served policy leaves to script. */
function AppearanceSurface(props: {
  readonly theme: ThemeDocument | undefined;
  readonly scheme?: "light" | "dark";
  readonly className: string;
  readonly children: ReactNode;
}): ReactNode {
  const surface = useRef<HTMLDivElement>(null);
  const { theme } = props;
  useLayoutEffect(() => {
    const element = surface.current;
    if (element === null || theme === undefined) return;
    const assignments = themeColourAssignmentsOf(theme);
    for (const { property, value } of assignments)
      element.style.setProperty(property, value);
    return () => {
      for (const { property } of assignments)
        element.style.removeProperty(property);
    };
  }, [theme]);
  return (
    <div
      ref={surface}
      className={`appearance-surface ${props.className}`}
      data-scheme={props.scheme}
    >
      {props.children}
    </div>
  );
}

const appearanceSchemes = [
  { scheme: "light", word: "settings-appearance-preview-light" },
  { scheme: "dark", word: "settings-appearance-preview-dark" },
] as const;

const appearanceIconSizes = ["small", "large"] as const;

const appearanceBandWidths = [
  { width: "phone", word: "settings-appearance-preview-phone" },
  { width: "desk", word: "settings-appearance-preview-desk" },
] as const;

/** The image as it is drawn: the icon at each size on each scheme's surface,
 * the banner as the band at each width. */
function AppearancePreview(props: {
  readonly partition: PartitionIdentity;
  readonly role: ProjectImageRole;
  readonly artifact: string;
  readonly theme: ThemeDocument | undefined;
}): ReactNode {
  const text = useCopyText();
  const named = useProjectNamed()(props.partition);
  if (props.role === "icon")
    return (
      <div
        role="group"
        aria-label={text({ id: "settings-appearance-icon-preview" })}
        className="appearance-preview"
      >
        {appearanceSchemes.map(({ scheme, word }) => (
          <AppearanceSurface
            key={scheme}
            theme={props.theme}
            scheme={scheme}
            className="appearance-icons"
          >
            <span className="appearance-preview-word">
              {text({ id: word })}
            </span>
            {appearanceIconSizes.map((size) => (
              <ProjectImage
                key={size}
                partition={props.partition}
                artifact={props.artifact}
                alt={named}
                className={`appearance-icon appearance-icon-${size}`}
              />
            ))}
          </AppearanceSurface>
        ))}
      </div>
    );
  return (
    <div
      role="group"
      aria-label={text({ id: "settings-appearance-banner-preview" })}
      className="appearance-preview"
    >
      {appearanceBandWidths.map(({ width, word }) => (
        <div key={width} className={`appearance-band-at-${width}`}>
          <span className="appearance-preview-word">{text({ id: word })}</span>
          <AppearanceSurface theme={props.theme} className="appearance-band">
            <ProjectImage
              partition={props.partition}
              artifact={props.artifact}
              alt=""
              className="appearance-band-image"
            />
          </AppearanceSurface>
        </div>
      ))}
    </div>
  );
}

/** The button choosing a file, which opens the browser's own picker of the
 * types the roles take, and the one clearing the image where it is set. */
function AppearanceImageActions(props: {
  readonly role: ProjectImageRole;
  readonly held: boolean;
  readonly busy: boolean;
  readonly onFile: (file: File) => void;
  readonly onClear: () => void;
}): ReactNode {
  const text = useCopyText();
  const picker = useRef<HTMLInputElement>(null);
  const words = appearanceImageWords[props.role];
  return (
    <div className="appearance-actions">
      <input
        ref={picker}
        type="file"
        hidden
        accept={projectImageMediaTypes.join(",")}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file !== undefined) props.onFile(file);
        }}
      />
      <Button
        named={text({ id: words.choose })}
        busy={props.busy}
        disabled={props.busy}
        onClick={() => {
          picker.current?.click();
        }}
      >
        {props.busy
          ? text({ id: "settings-appearance-image-uploading" })
          : text({ id: "settings-appearance-image-choose" })}
      </Button>
      {props.held ? (
        <Button
          variant="quiet"
          named={text({ id: words.clear })}
          disabled={props.busy}
          onClick={props.onClear}
        >
          {text({ id: "settings-appearance-image-clear" })}
        </Button>
      ) : null}
    </div>
  );
}

/** One image's field: what it is now, a button choosing a file, and one
 * clearing it. */
function AppearanceImage(props: {
  readonly partition: PartitionIdentity;
  readonly role: ProjectImageRole;
}): ReactNode {
  const text = useCopyText();
  const { partition, role } = props;
  const read = usePanelState(projectImagesQuery(partition));
  const theme = usePanelState(projectThemeQuery(partition));
  const writing = useConsoleWrite(
    appearanceImageWrite(partition, role, useProjectImageHeld(partition)),
    { drawn: true },
  );
  const [refused, setRefused] = useState<Copy | undefined>(undefined);
  if (read.state !== "Ready") return <PanelUnready state={read} />;
  const words = appearanceImageWords[role];
  const artifact = read.value[role];
  const error = refused === undefined ? writing.error?.message : text(refused);
  return (
    <FormField
      label={text({ id: words.label })}
      hint={text(projectImageHint(role))}
      {...(error === undefined ? {} : { error })}
    >
      {(field) => (
        <div
          id={field.id}
          role="group"
          aria-labelledby={field.labelId}
          aria-describedby={field.describedBy}
          className="appearance-image"
        >
          {artifact === undefined ? (
            <p
              className={`appearance-placeholder appearance-placeholder-${role}`}
            >
              {text({ id: words.none })}
            </p>
          ) : (
            <AppearancePreview
              partition={partition}
              role={role}
              artifact={artifact}
              theme={theme.state === "Ready" ? theme.value.document : undefined}
            />
          )}
          <AppearanceImageActions
            role={role}
            held={artifact !== undefined}
            busy={writing.isPending}
            onFile={(file) => {
              const offer = projectImageOffered(role, file);
              if (offer.kind === "Refused") {
                writing.reset();
                setRefused(offer.refused);
                return;
              }
              setRefused(undefined);
              writing.mutate({ file, mediaType: offer.mediaType });
            }}
            onClear={() => {
              setRefused(undefined);
              writing.mutate(undefined);
            }}
          />
        </div>
      )}
    </FormField>
  );
}

export function AppearanceSettingsPage(): ReactNode {
  const text = useCopyText();
  const params = useParams({ from: settingsRoutes.project.appearance });
  const partition: PartitionIdentity = {
    tenant: params.tenant,
    project: params.project,
  };
  const abilities = useProjectAbilities(partition);
  return (
    <SettingsPage title={text({ id: "settings-nav-appearance" })}>
      {projectAbilityRefused(abilities, "administer") ? (
        <ViewOnlyNotice />
      ) : (
        <div className="appearance">
          <AppearanceTheme partition={partition} />
          <AppearanceImage partition={partition} role="icon" />
          <AppearanceImage partition={partition} role="banner" />
        </div>
      )}
    </SettingsPage>
  );
}
