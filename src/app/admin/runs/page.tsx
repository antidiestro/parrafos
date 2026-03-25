import Link from "next/link";
import { requireAdminSession } from "@/lib/auth/require-admin";
import { listRecentRuns } from "@/lib/data/runs";
import { StartRunForm } from "./start-run-form";

export const dynamic = "force-dynamic";

function formatTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

type RunMetadata = {
  publishers_done?: number;
  publisher_count?: number;
  articles_found?: number;
  articles_upserted?: number;
};

export default async function AdminRunsPage() {
  await requireAdminSession();
  const runs = await listRecentRuns();

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Runs</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Queue and track extraction runs across all publishers.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/admin"
            className="text-sm font-medium text-zinc-600 underline-offset-4 hover:text-zinc-900 hover:underline"
          >
            Back to publishers
          </Link>
        </div>
      </header>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          New run
        </h2>
        <StartRunForm />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Recent runs ({runs.length})
        </h2>
        <div className="overflow-x-auto rounded-xl border border-zinc-200">
          <table className="w-full min-w-2xl text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3">Started</th>
                <th className="px-4 py-3">Ended</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Publishers</th>
                <th className="px-4 py-3">Found</th>
                <th className="px-4 py-3">Upserted</th>
                <th className="px-4 py-3">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white">
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
                    No runs yet. Start one above.
                  </td>
                </tr>
              ) : (
                runs.map((run) => {
                  const metadata = (run.metadata as RunMetadata | null) ?? null;
                  return (
                    <tr key={run.id} className="align-top">
                      <td className="whitespace-nowrap px-4 py-3 text-zinc-900">
                        <Link
                          href={`/admin/runs/${run.id}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {formatTime(run.started_at)}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-zinc-500">
                        {formatTime(run.ended_at)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-zinc-900">
                        {run.status}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-zinc-600">
                        {metadata?.publishers_done ?? 0}/{metadata?.publisher_count ?? 0}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-zinc-600">
                        {metadata?.articles_found ?? 0}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-zinc-600">
                        {metadata?.articles_upserted ?? 0}
                      </td>
                      <td className="max-w-xs truncate px-4 py-3 text-zinc-600">
                        {run.error_message ?? "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
