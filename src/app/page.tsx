import Image from "next/image";

import { BriefViewer } from "@/components/brief-viewer";
import { getLatestPublishedBriefWithStories } from "@/lib/data/briefs";

/** Wall-clock interpretation for homepage copy (Chile). */
const BRIEF_DISPLAY_TIMEZONE = "America/Santiago";

type DayPart = "madrugada" | "mañana" | "tarde" | "noche";

function zonedYmdHour(d: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const pick = (type: Intl.DateTimeFormatPart["type"]) =>
    parts.find((p) => p.type === type)?.value;
  const year = Number(pick("year"));
  const month = Number(pick("month"));
  const day = Number(pick("day"));
  let hour = Number(pick("hour"));
  if ([year, month, day, hour].some((n) => Number.isNaN(n))) {
    return null;
  }
  if (hour === 24) hour = 0;
  return { year, month, day, hour };
}

function sameCalendarDayInTimeZone(a: Date, b: Date, timeZone: string) {
  const za = zonedYmdHour(a, timeZone);
  const zb = zonedYmdHour(b, timeZone);
  if (!za || !zb) return false;
  return za.year === zb.year && za.month === zb.month && za.day === zb.day;
}

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
  timeZone: string,
): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const z = zonedYmdHour(d, timeZone);
  if (!z) return null;
  const part = dayPartFromHour(z.hour);

  if (sameCalendarDayAsNow) {
    if (part === "madrugada") return "de esta madrugada";
    if (part === "mañana") return "de esta mañana";
    if (part === "tarde") return "de esta tarde";
    return "de esta noche";
  }

  const datePart = new Intl.DateTimeFormat("es", {
    timeZone,
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
  const sameDay = sameCalendarDayInTimeZone(d, now, BRIEF_DISPLAY_TIMEZONE);
  const dayPart = dayPartPhraseEs(iso, sameDay, BRIEF_DISPLAY_TIMEZONE);
  if (!dayPart) return null;
  return `Hola. Aquí tienes los Párrafos ${dayPart}.`;
}

/** e.g. "Actualizado a las 18:43" — `es` locale, 24h time from brief `created_at`. */
function formatBriefUpdatedAtLineEs(
  iso: string | null | undefined,
): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const time = new Intl.DateTimeFormat("es", {
    timeZone: BRIEF_DISPLAY_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `Actualizado a las ${time}`;
}

export default async function HomePage() {
  const bundle = await getLatestPublishedBriefWithStories();
  const createdAt = bundle?.brief.created_at;
  const greetingLine = bundle ? formatBriefGreetingEs(createdAt) : null;
  const updatedAtLine = bundle ? formatBriefUpdatedAtLineEs(createdAt) : null;

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-6 pt-24 pb-32">
      {!bundle ? (
        <p className="text-lg text-zinc-600">
          No published brief is available yet. Check back soon.
        </p>
      ) : (
        <article className="space-y-14">
          <header className="space-y-3">
            {updatedAtLine ? (
              <p
                className="font-sans text-sm leading-normal text-zinc-500"
                lang="es"
              >
                {updatedAtLine}
              </p>
            ) : null}
            <p className="text-2xl leading-relaxed" lang="es">
              {greetingLine ?? "Hola. Aquí tienes los Párrafos."}
            </p>
          </header>

          <BriefViewer bundle={bundle} />
        </article>
      )}

      <div className="mt-16">
        <a
          href="https://ko-fi.com/L4L71WRTKN"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block"
        >
          <Image
            src="https://storage.ko-fi.com/cdn/kofi3.png?v=6"
            alt="Buy Me a Coffee at ko-fi.com"
            width={580}
            height={146}
            className="h-9 w-auto border-0"
          />
        </a>
      </div>
    </main>
  );
}
