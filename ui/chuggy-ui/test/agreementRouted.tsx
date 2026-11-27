/**
 * What a case's mock of the router draws in its place: one read and one
 * write, each through the ports the screens make, and the read's content, so
 * a case can see a refused read asked again and a refused write left alone.
 * The read is kept for ever once it has landed, as a streamed one is, so
 * nothing but its being marked asks it again on a mount.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useApiPorts } from "../app/browser/api.ts";
import { apiOrThrow, apiRead, apiSend } from "../app/core/apiRequest.ts";

export const agreementRoutedReadPath = "/api/v1/installation";
export const agreementRoutedWritePath = "/api/v1/appearance/choice";
export const agreementRoutedContent = "Installation read";

export function AgreementRouted(): ReactNode {
  const ports = useApiPorts();
  const read = useQuery({
    queryKey: ["agreementRouted"],
    queryFn: async ({ signal }) =>
      apiOrThrow(
        await apiRead(
          ports,
          { method: "GET", path: agreementRoutedReadPath, signal },
          () => agreementRoutedContent,
        ),
        (failure) => failure.outcome,
      ),
    staleTime: Infinity,
  });
  const write = useMutation({
    mutationFn: () =>
      apiSend(ports, {
        method: "PUT",
        path: agreementRoutedWritePath,
        body: {},
      }),
  });
  return (
    <div>
      <p>Routed</p>
      <p>{read.isError ? "Read failed" : (read.data ?? "Reading")}</p>
      <button
        type="button"
        onClick={() => {
          void read.refetch();
        }}
      >
        Read again
      </button>
      <button
        type="button"
        onClick={() => {
          write.mutate();
        }}
      >
        Write
      </button>
    </div>
  );
}
