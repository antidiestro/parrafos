import { NextResponse } from "next/server";
import { cancelRunAction } from "@/app/admin/runs/run-actions";

type RouteProps = {
  params: Promise<{ runId: string }>;
};

export async function POST(_request: Request, { params }: RouteProps) {
  const { runId } = await params;
  const result = await cancelRunAction(runId);
  if (result?.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}
