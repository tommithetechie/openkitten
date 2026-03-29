import type { DiscordChunk } from "~/lib/discord-chunk";

const discordMaxLength = 2000;
const discordSplitLength = Math.floor(discordMaxLength * 0.8);

interface CodeBlockRange {
  readonly start: number;
  readonly end: number;
  readonly lang: string;
}

function findCodeBlockRanges(text: string): readonly CodeBlockRange[] {
  const ranges: CodeBlockRange[] = [];
  const regex = /^```(\w*)/gm;
  let openStart: number | null = null;
  let openLang = "";

  for (let match = regex.exec(text); match !== null; match = regex.exec(text)) {
    if (openStart === null) {
      openStart = match.index;
      openLang = match[0].slice(3);
    } else {
      ranges.push({
        start: openStart,
        end: match.index + match[0].length,
        lang: openLang,
      });
      openStart = null;
      openLang = "";
    }
  }

  if (openStart !== null) {
    ranges.push({ start: openStart, end: text.length, lang: openLang });
  }

  return ranges;
}

function isInCodeBlock(
  pos: number,
  ranges: readonly CodeBlockRange[],
): CodeBlockRange | null {
  for (const range of ranges) {
    if (pos > range.start && pos < range.end) return range;
  }
  return null;
}

interface SplitPriority {
  readonly pattern: RegExp;
  readonly offset: number;
}

const splitPriorities: readonly SplitPriority[] = [
  { pattern: /\n(?=#{1,6} |---|___|\*\*\*)/g, offset: 0 },
  { pattern: /\n\n/g, offset: 0 },
  { pattern: /\n(?=[-*] |\d+\. )/g, offset: 0 },
  { pattern: /\n/g, offset: 0 },
  { pattern: /[.!?] /g, offset: 1 },
  { pattern: / /g, offset: 0 },
];

function splitMessage(text: string, maxLength: number): readonly string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    const codeBlocks = findCodeBlockRanges(remaining);
    let splitPos = -1;

    for (const { pattern, offset } of splitPriorities) {
      if (splitPos !== -1) break;

      let best = -1;
      const searchRegex = new RegExp(pattern.source, pattern.flags);
      for (
        let m = searchRegex.exec(remaining);
        m !== null;
        m = searchRegex.exec(remaining)
      ) {
        const candidatePos = m.index + offset;
        if (candidatePos >= maxLength) break;
        if (!isInCodeBlock(candidatePos, codeBlocks)) {
          best = candidatePos;
        }
      }
      if (best > 0) splitPos = best;
    }

    if (splitPos === -1) {
      const block = isInCodeBlock(maxLength, codeBlocks);
      if (block) {
        let bestNewline = -1;
        for (let i = maxLength - 1; i > block.start; i--) {
          if (remaining[i] === "\n") {
            bestNewline = i;
            break;
          }
        }

        const reopenPrefix = `\`\`\`${block.lang}\n`;
        if (bestNewline > block.start && bestNewline > reopenPrefix.length) {
          const chunk = `${remaining.slice(0, bestNewline).trimEnd()}\n\`\`\``;
          chunks.push(chunk);
          remaining = reopenPrefix + remaining.slice(bestNewline + 1);
          continue;
        }
      }

      splitPos = maxLength;
    }

    const chunk = remaining.slice(0, splitPos).trimEnd();
    chunks.push(chunk);
    remaining = remaining.slice(splitPos).trimStart();
  }

  chunks.push(remaining);
  return chunks;
}

function convertSingleChunk(chunk: string): DiscordChunk {
  // Discord markdown doesn't require the same escaping as Telegram's MarkdownV2
  // We just use standard markdown formatting
  return { text: chunk, markdown: chunk };
}

function tryConvert(chunk: string): readonly DiscordChunk[] {
  const result = convertSingleChunk(chunk);
  if (result.markdown === undefined) return [result];
  if (result.markdown.length <= discordMaxLength) return [result];

  // Markdown expansion caused the text to exceed Discord's limit.
  // Re-split the source at a smaller size estimated from the expansion ratio.
  const ratio = discordMaxLength / result.markdown.length;
  const smallerLimit = Math.floor(chunk.length * ratio * 0.9);
  const subChunks = splitMessage(chunk, smallerLimit);
  const results: DiscordChunk[] = [];
  for (const sub of subChunks) {
    const subResult = convertSingleChunk(sub);
    if (
      subResult.markdown !== undefined &&
      subResult.markdown.length <= discordMaxLength
    ) {
      results.push(subResult);
    } else {
      results.push({ text: sub });
    }
  }
  return results;
}

const hrPattern = /(?:^|\n)[ \t]*(?:---+|___+|\*\*\*+)[ \t]*(?:\n|$)/;

export function discordFormatText(text: string): readonly DiscordChunk[] {
  const sections = text.split(hrPattern);
  const results: DiscordChunk[] = [];

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;

    const chunks = splitMessage(trimmed, discordSplitLength);
    for (const chunk of chunks) {
      results.push(...tryConvert(chunk));
    }
  }

  return results;
}
