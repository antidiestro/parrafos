"use client";

import { useActionState } from "react";
import {
  createPublisherAction,
  type PublisherActionState,
} from "./publisher-actions";

const initial: PublisherActionState = null;

export function CreatePublisherForm() {
  const [state, formAction, pending] = useActionState(
    createPublisherAction,
    initial,
  );

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 sm:flex-row sm:flex-wrap sm:items-end"
    >
      <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs font-medium text-zinc-700">
        Name
        <input
          name="name"
          required
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
        />
      </label>
      <label className="flex min-w-48 flex-2 flex-col gap-1 text-xs font-medium text-zinc-700">
        Base URL
        <input
          name="base_url"
          type="url"
          required
          placeholder="https://example.com"
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Adding…" : "Add publisher"}
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
