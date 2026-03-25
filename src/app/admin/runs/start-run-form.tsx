"use client";

import { useActionState } from "react";
import { startRunAction, type RunActionState } from "./run-actions";

const initial: RunActionState = null;

export function StartRunForm() {
  const [state, formAction, pending] = useActionState(startRunAction, initial);

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-sm text-zinc-700">
        Enqueue a background run to crawl all publishers and extract articles.
      </p>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Starting…" : "Start a run"}
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
