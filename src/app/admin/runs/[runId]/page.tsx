import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminSession } from "@/lib/auth/require-admin";
import { getRunDetailPayload } from "@/lib/data/runs";
import { RunDetailClient } from "./run-detail-client";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ runId: string }>;
};

export default async function AdminRunDetailPage({ params }: PageProps) {
  await requireAdminSession();
  const { runId } = await params;
  const payload = await getRunDetailPayload(runId);

  if (!payload) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Run details</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Inspect publishers, identified articles, and extraction progress.
          </p>
        </div>
        <Link
          href="/admin/runs"
          className="text-sm font-medium text-zinc-600 underline-offset-4 hover:text-zinc-900 hover:underline"
        >
          Back to runs
        </Link>
      </header>

      <RunDetailClient runId={runId} initialData={payload} />
    </main>
  );
}
