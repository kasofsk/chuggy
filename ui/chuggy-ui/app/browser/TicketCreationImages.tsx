/**
 * The images a ticket carries, attached in the form: picked, pasted or
 * dropped, each uploaded as the bytes it is and held as the identity the
 * upload answered.
 *
 * AN ATTACHING THAT FAILS ATTACHES NOTHING. Its images are added to the form
 * only once every upload of it has answered, so a draft never names an image
 * the project was not given, and the refusal is said beside the control with
 * the form as it was. The bound is the brief's own, and the control says it
 * rather than leaving a release to refuse it.
 */

import { useEffect, useRef, useState } from "react";
import type { ClipboardEvent, DragEvent, ReactNode } from "react";

import { briefImagesMax } from "../../../../src/contract/brief.ts";
import { imageMediaTypes } from "../../../../src/contract/http.ts";
import type {
  ImageMediaType,
  PartitionIdentity,
} from "../../../../src/contract/http.ts";
import type { ApiPorts, ApiResult } from "../core/apiRequest.ts";
import { apiUploadProjectArtifact } from "../core/apiRoutes.ts";
import { consoleWriteKey } from "../core/consoleWrite.ts";
import type { ConsoleWrite } from "../core/consoleWrite.ts";
import {
  creationImageMediaType,
  creationImagesBoundSentence,
  creationImagesTaken,
  creationImageTypesLabel,
  creationImageUploadSentence,
} from "../core/ticketCreation.ts";
import type { TicketCreationForm } from "../core/ticketCreation.ts";
import { useConsoleWrite } from "./consoleWrite.tsx";
import { ProjectImage, useProjectImageHeld } from "./ProjectImage.tsx";
import { Button } from "./ui/Button.tsx";

/** What the field uploads through: the ports and the project the screen holds. */
export interface CreationImagesApi {
  readonly ports: ApiPorts;
  readonly partition: PartitionIdentity;
  /** Where the form the images are attached to keeps its YAML, which is the
   * one form an attaching under it is taken up by. */
  readonly storeKey: string;
}

interface FormEdit {
  readonly form: TicketCreationForm;
  readonly onChange: (form: TicketCreationForm) => void;
}

/** One image as the bytes it is, and what its upload answered. */
interface CreationImageUploaded {
  readonly artifact: string;
  readonly mediaType: ImageMediaType;
  readonly content: Uint8Array<ArrayBuffer>;
}

/** Every file uploaded in order, or the answer of the first that failed. */
async function creationImagesUploaded(
  ports: ApiPorts,
  partition: PartitionIdentity,
  files: readonly File[],
): Promise<ApiResult<readonly CreationImageUploaded[]>> {
  const uploaded: CreationImageUploaded[] = [];
  for (const file of files) {
    const mediaType = creationImageMediaType(file.type);
    if (mediaType === undefined) continue;
    const content = new Uint8Array(await file.arrayBuffer());
    const answered = await apiUploadProjectArtifact(ports, partition, {
      mediaType,
      content,
    });
    if (answered.outcome !== "Ok") return answered;
    uploaded.push({ artifact: answered.value.artifact, mediaType, content });
  }
  return { outcome: "Ok", value: uploaded };
}

/** One attaching through the ports the field was handed, the bytes it sent
 * written as the project's read of each image before it is over. */
function creationImagesWrite(
  api: CreationImagesApi,
  held: ReturnType<typeof useProjectImageHeld>,
): ConsoleWrite<readonly File[], readonly CreationImageUploaded[]> {
  const { ports, partition } = api;
  return {
    mutationKey: consoleWriteKey("creation-images", api.storeKey),
    write: (_ports, files) => creationImagesUploaded(ports, partition, files),
    refusal: creationImageUploadSentence,
    landed: (_client, uploaded) => {
      for (const image of uploaded)
        held(image.artifact, image.mediaType, image.content);
      return Promise.resolve();
    },
  };
}

/** What one attaching does: uploads what it takes of the files offered, and
 * adds the identities to the form as it is once every upload has answered.
 * `bound` is what the offer itself was refused in, said once nothing else is. */
function useCreationImagesAttach(props: FormEdit & CreationImagesApi) {
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });
  const uploading = useConsoleWrite(
    creationImagesWrite(props, useProjectImageHeld(props.partition)),
    { drawn: true },
  );
  const [bound, setBound] = useState<string | undefined>(undefined);
  const attach = (files: readonly File[]): void => {
    const offered = creationImagesTaken(props.form.images.length, files);
    setBound(offered.refused);
    if (offered.taken.length === 0) {
      uploading.reset();
      return;
    }
    uploading.mutate(offered.taken, {
      onSuccess: (uploaded) => {
        const now = latest.current.form;
        latest.current.onChange({
          ...now,
          images: [...now.images, ...uploaded.map((image) => image.artifact)],
        });
      },
    });
  };
  const refused = uploading.isPending
    ? undefined
    : (uploading.error?.message ?? bound);
  return { busy: uploading.isPending, refused, attach };
}

/** The line beside the control: what the last attaching came to, and how
 * many of the bound the ticket holds. */
function CreationImagesNote(props: {
  readonly busy: boolean;
  readonly refused: string | undefined;
  readonly count: number;
}): ReactNode {
  return (
    <p className="text-ink-3 m-0 text-sm" role="status">
      <span className="num">
        {props.count} / {briefImagesMax}
      </span>
      {props.busy ? " · uploading…" : null}
      {props.refused === undefined ? null : (
        <span className="text-tone-fail"> · {props.refused}</span>
      )}
    </p>
  );
}

/** The images held, each drawn from the project's read and removable. */
function CreationImagesHeld(
  props: FormEdit & { readonly partition: PartitionIdentity },
): ReactNode {
  const { form, onChange } = props;
  if (form.images.length === 0) return null;
  return (
    <ul aria-label="Images" className="m-0 flex flex-wrap gap-2 p-0">
      {form.images.map((artifact, at) => (
        <li key={artifact} className="flex items-end gap-1">
          <ProjectImage
            partition={props.partition}
            artifact={artifact}
            alt={`Image ${String(at + 1)}`}
            className="rounded-2 border-edge block h-[calc(var(--space-7)*2)] max-w-full border"
          />
          <Button
            size="sm"
            onClick={() => {
              onChange({
                ...form,
                images: form.images.filter((_, index) => index !== at),
              });
            }}
          >
            Remove
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** The picker, and the place a paste or a drop is aimed at. */
function CreationImagesPick(props: {
  readonly full: boolean;
  readonly busy: boolean;
  readonly onFiles: (files: readonly File[]) => void;
}): ReactNode {
  return (
    <div
      tabIndex={0}
      role="group"
      className="creation-row"
      aria-label="Paste or drop images here"
    >
      <span>Attach</span>
      <input
        type="file"
        multiple
        accept={imageMediaTypes.join(",")}
        aria-label="Attach images"
        disabled={props.full || props.busy}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length > 0) props.onFiles(files);
        }}
      />
      <span className="creation-hint text-ink-3 text-xs">
        {props.full
          ? creationImagesBoundSentence
          : `Pick, paste or drop · ${creationImageTypesLabel}`}
      </span>
    </div>
  );
}

export function CreationImages(
  props: FormEdit & { readonly api: CreationImagesApi },
): ReactNode {
  const { form } = props;
  const { busy, refused, attach } = useCreationImagesAttach({
    ...props,
    ...props.api,
  });
  const offered = (
    files: FileList | null,
    event: { readonly preventDefault: () => void },
  ): void => {
    const held = Array.from(files ?? []);
    if (held.length === 0) return;
    event.preventDefault();
    if (!busy) attach(held);
  };
  return (
    <fieldset
      className="creation-set"
      onPaste={(event: ClipboardEvent<HTMLFieldSetElement>) => {
        offered(event.clipboardData.files, event);
      }}
      onDragOver={(event: DragEvent<HTMLFieldSetElement>) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event: DragEvent<HTMLFieldSetElement>) => {
        offered(event.dataTransfer.files, event);
      }}
    >
      <legend>Images</legend>
      <CreationImagesHeld
        form={form}
        onChange={props.onChange}
        partition={props.api.partition}
      />
      <CreationImagesPick
        full={form.images.length >= briefImagesMax}
        busy={busy}
        onFiles={attach}
      />
      <CreationImagesNote
        busy={busy}
        refused={refused}
        count={form.images.length}
      />
    </fieldset>
  );
}
