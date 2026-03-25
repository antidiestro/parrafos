import Link from "next/link";
import { logoutAction } from "@/app/admin/login/actions";
import { requireAdminSession } from "@/lib/auth/require-admin";
import { listPublishers } from "@/lib/data/publishers";
import { CreatePublisherForm } from "./create-publisher-form";
import { DeletePublisherButton } from "./delete-publisher-button";
import { EditPublisherForm } from "./edit-publisher-form";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  await requireAdminSession();
  const { edit } = await searchParams;
  const publishers = await listPublishers();
  const editing = edit ? (publishers.find((p) => p.id === edit) ?? null) : null;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Publishers</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Create, update, or remove news sources (server-side only).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/admin/runs"
            className="text-sm font-medium text-zinc-600 underline-offset-4 hover:text-zinc-900 hover:underline"
          >
            View runs
          </Link>
          <Link
            href="/"
            className="text-sm font-medium text-zinc-600 underline-offset-4 hover:text-zinc-900 hover:underline"
          >
            View site
          </Link>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          New publisher
        </h2>
        <CreatePublisherForm />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          All publishers ({publishers.length})
        </h2>
        <div className="overflow-x-auto rounded-xl border border-zinc-200">
          <table className="w-full min-w-xl text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Base URL</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white">
              {publishers.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-zinc-500"
                  >
                    No publishers yet. Add one above.
                  </td>
                </tr>
              ) : (
                publishers.map((p) => (
                  <tr key={p.id} className="align-top">
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-zinc-900">
                      {p.name}
                    </td>
                    <td className="max-w-56 truncate px-4 py-3 text-zinc-600">
                      <a
                        href={p.base_url}
                        className="text-zinc-900 underline-offset-2 hover:underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {p.base_url}
                      </a>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-500">
                      {new Intl.DateTimeFormat(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(p.updated_at))}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Link
                          href={
                            edit === p.id ? "/admin" : `/admin?edit=${p.id}`
                          }
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
                        >
                          {edit === p.id ? "Close" : "Edit"}
                        </Link>
                        <DeletePublisherButton id={p.id} name={p.name} />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {editing ? (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Edit publisher
          </h2>
          <EditPublisherForm publisher={editing} />
        </section>
      ) : null}
    </main>
  );
}
