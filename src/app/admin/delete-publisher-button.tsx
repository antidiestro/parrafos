"use client";

import { useActionState } from "react";
import {
  deletePublisherAction,
  type PublisherActionState,
} from "./publisher-actions";

const initial: PublisherActionState = null;

export function DeletePublisherButton({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const [state, formAction, pending] = useActionState(
    deletePublisherAction,
    initial,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        title={`Delete ${name}`}
        className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-900 hover:bg-red-100 disabled:opacity-60"
        onClick={(e) => {
          if (
            !confirm(
              `Delete publisher “${name}”? This fails if articles still reference it.`,
            )
          ) {
            e.preventDefault();
          }
        }}
      >
        {pending ? "…" : "Delete"}
      </button>
      {state?.error ? (
        <p className="mt-1 max-w-xs text-xs text-red-700" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
