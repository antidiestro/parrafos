import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/require-admin";
import { getRunDetailPayload } from "@/lib/data/runs";

type RouteProps = {
  params: Promise<{ runId: string }>;
};

export async function GET(_request: Request, { params }: RouteProps) {
  await requireAdminSession();
  const { runId } = await params;
  const payload = await getRunDetailPayload(runId);

  if (!payload) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  return NextResponse.json(payload);
}
