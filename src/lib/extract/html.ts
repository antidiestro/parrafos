import { load } from "cheerio";

const MAX_CHARS = 200_000;

export function cleanHtmlForLLM(html: string): string {
  const $ = load(html);
  $("head,style,script,svg").remove();
  const content = $("body").html() ?? $.root().html() ?? "";
  return content.replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
}
