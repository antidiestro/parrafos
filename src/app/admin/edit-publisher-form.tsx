"use client";

import { useActionState } from "react";
import type { PublisherRow } from "@/lib/data/publishers";
import {
  type PublisherActionState,
  updatePublisherAction,
} from "./publisher-actions";

const initial: PublisherActionState = null;

export function EditPublisherForm({ publisher }: { publisher: PublisherRow }) {
  const [state, formAction, pending] = useActionState(
    updatePublisherAction,
    initial,
  );

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-lg border border-dashed border-zinc-300 bg-white p-3 sm:flex-row sm:flex-wrap sm:items-end"
    >
      <input type="hidden" name="id" value={publisher.id} />
      <label className="flex min-w-[8rem] flex-1 flex-col gap-1 text-xs font-medium text-zinc-700">
        Name
        <input
          name="name"
          required
          defaultValue={publisher.name}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
        />
      </label>
      <label className="flex min-w-[10rem] flex-[2] flex-col gap-1 text-xs font-medium text-zinc-700">
        Base URL
        <input
          name="base_url"
          type="url"
          required
          defaultValue={publisher.base_url}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      {state?.error ? (
        <p className="w-full text-sm text-red-700" role="alert">
          {state.error}
        </p>
      ) : null}
      {state?.success ? (
        <p className="w-full text-sm text-green-800" role="status">
          {state.success}
        </p>
      ) : null}
    </form>
  );
}
