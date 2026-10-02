export interface Heading { from: number; level: number; text: string }

/** Outline positions are UTF-16 offsets, matching CodeMirror's document. */
export function headings(text: string): Heading[] {
  const result: Heading[] = [];
  const lines = text.split("\n");
  let offset = 0;
  let fence: { marker: string; size: number } | undefined;
  let frontMatter = lines[0]?.trim() === "---" &&
    lines.slice(1).some(line => /^(?:---|\.\.\.)\s*$/.test(line));
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (frontMatter) {
      if (index > 0 && /^(?:---|\.\.\.)\s*$/.test(line)) frontMatter = false;
      offset += line.length + 1; continue;
    }
    const matchFence = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (matchFence && matchFence[1][0] === fence.marker && matchFence[1].length >= fence.size) fence = undefined;
      offset += line.length + 1; continue;
    }
    if (matchFence) { fence = { marker: matchFence[1][0], size: matchFence[1].length }; offset += line.length + 1; continue; }
    if (!/^ {0,3}>/.test(line)) {
      const atx = line.match(/^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/);
      if (atx) result.push({ from: offset, level: atx[1].length, text: atx[2].replace(/[*`_]/g, "") });
      else if (line.trim() && index + 1 < lines.length) {
        const underline = lines[index + 1].match(/^ {0,3}(=+|-+)\s*$/);
        if (underline) result.push({ from: offset, level: underline[1][0] === "=" ? 1 : 2, text: line.trim().replace(/[*`_]/g, "") });
      }
    }
    offset += line.length + 1;
  }
  return result;
}

export function wordCount(text: string): number {
  return (text.match(/[\p{Script=Han}]/gu) || []).length +
    (text.replace(/[\p{Script=Han}]/gu, " ").match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;
}
