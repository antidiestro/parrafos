"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminSession } from "@/lib/auth/require-admin";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type PublisherActionState = { error?: string; success?: string } | null;

const publisherFields = z.object({
  name: z.string().trim().min(1, "Name is required"),
  base_url: z.string().trim().url("Must be a valid URL"),
});

function formatZodError(err: z.ZodError): string {
  return err.issues.map((i) => i.message).join(" ");
}

export async function createPublisherAction(
  _prev: PublisherActionState,
  formData: FormData,
): Promise<PublisherActionState> {
  await requireAdminSession();

  const parsed = publisherFields.safeParse({
    name: formData.get("name"),
    base_url: formData.get("base_url"),
  });
  if (!parsed.success) {
    return { error: formatZodError(parsed.error) };
  }

  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.from("publishers").insert(parsed.data);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin");
  revalidatePath("/");
  return { success: "Publisher created." };
}

export async function updatePublisherAction(
  _prev: PublisherActionState,
  formData: FormData,
): Promise<PublisherActionState> {
  await requireAdminSession();

  const idParsed = z.string().uuid().safeParse(formData.get("id"));
  if (!idParsed.success) {
    return { error: "Invalid publisher id." };
  }

  const parsed = publisherFields.safeParse({
    name: formData.get("name"),
    base_url: formData.get("base_url"),
  });
  if (!parsed.success) {
    return { error: formatZodError(parsed.error) };
  }

  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("publishers")
    .update(parsed.data)
    .eq("id", idParsed.data);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin");
  revalidatePath("/");
  return { success: "Publisher updated." };
}

export async function deletePublisherAction(
  _prev: PublisherActionState,
  formData: FormData,
): Promise<PublisherActionState> {
  await requireAdminSession();

  const idParsed = z.string().uuid().safeParse(formData.get("id"));
  if (!idParsed.success) {
    return { error: "Invalid publisher id." };
  }

  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("publishers")
    .delete()
    .eq("id", idParsed.data);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin");
  revalidatePath("/");
  return { success: "Publisher deleted." };
}
