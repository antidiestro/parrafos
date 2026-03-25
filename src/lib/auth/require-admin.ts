import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/auth/admin-session";

export async function requireAdminSession(): Promise<void> {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) {
    redirect("/admin/login");
  }
  const jar = await cookies();
  const token = jar.get(ADMIN_SESSION_COOKIE)?.value;
  if (!(await verifyAdminSessionToken(secret, token))) {
    redirect("/admin/login");
  }
}
