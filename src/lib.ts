export function speechText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " The code is in the conversation. ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#*_`>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 3500);
}
export function folderName(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || path
  );
}
export function tokens(value: number): string {
  return new Intl.NumberFormat("en", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
