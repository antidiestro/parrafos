import { BriefViewer } from "@/components/brief-viewer";
import { getLatestPublishedBriefWithStories } from "@/lib/data/briefs";

export const dynamic = "force-dynamic";

type DayPart = "madrugada" | "mañana" | "tarde" | "noche";

function dayPartFromHour(hour: number): DayPart {
  if (hour >= 0 && hour < 5) return "madrugada";
  if (hour < 12) return "mañana";
  if (hour < 20) return "tarde";
  return "noche";
}

/** e.g. "de esta tarde", "de la mañana del 3 de abril" — from brief `created_at` hour & calendar day. */
function dayPartPhraseEs(
  iso: string,
  sameCalendarDayAsNow: boolean,
): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const part = dayPartFromHour(d.getHours());

  if (sameCalendarDayAsNow) {
    if (part === "madrugada") return "de esta madrugada";
    if (part === "mañana") return "de esta mañana";
    if (part === "tarde") return "de esta tarde";
    return "de esta noche";
  }

  const datePart = new Intl.DateTimeFormat("es", {
    day: "numeric",
    month: "long",
  }).format(d);
  if (part === "madrugada") return `de la madrugada del ${datePart}`;
  if (part === "mañana") return `de la mañana del ${datePart}`;
  if (part === "tarde") return `de la tarde del ${datePart}`;
  return `de la noche del ${datePart}`;
}

/** Full greeting line in Spanish, or null if timestamp missing/invalid. */
function formatBriefGreetingEs(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const dayPart = dayPartPhraseEs(iso, sameDay);
  if (!dayPart) return null;
  const time = new Intl.DateTimeFormat("es", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `Hola. Aquí tienes los Párrafos ${dayPart}, actualizados a las ${time}.`;
}

export default async function HomePage() {
  const bundle = await getLatestPublishedBriefWithStories();
  const greetingLine = bundle
    ? formatBriefGreetingEs(bundle.brief.created_at)
    : null;

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-6 py-16 pb-24">
      {!bundle ? (
        <p className="text-lg text-zinc-600">
          No published brief is available yet. Check back soon.
        </p>
      ) : (
        <article className="space-y-10">
          <p className="text-xl leading-relaxed" lang="es">
            {greetingLine ?? "Hola. Aquí tienes los Párrafos."}
          </p>

          <BriefViewer bundle={bundle} />
        </article>
      )}

    </main>
  );
}
