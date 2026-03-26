import { load } from "cheerio";

const MAX_CHARS = 200_000;

export function cleanHtmlForLLM(html: string): string {
  const $ = load(html);
  $("head,style,script,svg").remove();
  const content = $("body").html() ?? $.root().html() ?? "";
  const collapsed = content.replace(/\s+/g, " ").trim();
  const output = collapsed.slice(0, MAX_CHARS);
  console.log(
    `[worker:runs] ${new Date().toISOString()} cleanHtmlForLLM`,
    {
      inputChars: html.length,
      collapsedChars: collapsed.length,
      outputChars: output.length,
      truncated: collapsed.length > MAX_CHARS,
    },
  );
  return output;
}

export function cleanTextForLLM(html: string): string {
  const $ = load(html);
  $("head,style,script,svg").remove();
  const text = $("body").text() || $.root().text() || "";
  const collapsed = text.replace(/\s+/g, " ").trim();
  const output = collapsed.slice(0, MAX_CHARS);
  console.log(
    `[worker:runs] ${new Date().toISOString()} cleanTextForLLM`,
    {
      inputChars: html.length,
      collapsedChars: collapsed.length,
      outputChars: output.length,
      truncated: collapsed.length > MAX_CHARS,
    },
  );
  return output;
}
