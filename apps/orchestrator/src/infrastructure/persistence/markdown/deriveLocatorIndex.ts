import { createHash } from 'node:crypto';
import { createEvidenceLocator } from '@solutions-studio/domain';
import type { LocatorIndexEntry } from '../../../application/ports/persistence/IRequirementsRepository.js';

export function computeContentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function slugifyHeading(rawHeadingText: string): string {
  let s = rawHeadingText.replace(/^#+\s*/, '');
  s = s.replace(/&/g, ' and ');
  s = s.replace(/^\s*[0-9]+(?:\.[0-9]+)*[.)]?\s+/, '');
  s = s.toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, '-');
  s = s.replace(/^-+|-+$/g, '');
  return s || 'section';
}

export function extractSectionLabel(blockFirstLine: string): string | undefined {
  const m = /^Section\s+([0-9]+(?:\.[0-9]+)*)\s*:/i.exec(blockFirstLine);
  return m ? m[1] : undefined;
}

export function deriveLocatorIndex(markdownText: string): LocatorIndexEntry[] {
  const lines = markdownText.split(/\r?\n/);
  const entries: LocatorIndexEntry[] = [];
  let currentHeadingPath = 'preamble';
  let unlabeledCount = 0;
  const seenHeadingPaths = new Map<string, number>();
  const seenLocators = new Map<string, number>();
  const ancestorStack: { level: number; slug: string }[] = [];

  let inCodeBlock = false;
  let codeBlockMarker = '';

  let currentBlockLines: string[] = [];
  let currentBlockStartLine = 0;

  function flushBlock(endLine: number) {
    if (currentBlockLines.length === 0) return;
    const text = currentBlockLines.join('\n');
    const firstLine = currentBlockLines[0];
    const sectionLabel = extractSectionLabel(firstLine);
    let blockLabel: string;
    let blockLabelSource: 'explicit-section' | 'sequential-ordinal';

    if (sectionLabel !== undefined) {
      blockLabel = sectionLabel;
      blockLabelSource = 'explicit-section';
    } else {
      unlabeledCount++;
      blockLabel = String(unlabeledCount);
      blockLabelSource = 'sequential-ordinal';
    }

    const baseLocator = `${currentHeadingPath}#${blockLabel}`;
    let finalLocator = baseLocator;
    if (seenLocators.has(baseLocator)) {
      const count = seenLocators.get(baseLocator)! + 1;
      seenLocators.set(baseLocator, count);
      finalLocator = `${baseLocator}-dup${count}`;
    } else {
      seenLocators.set(baseLocator, 1);
    }

    entries.push(
      Object.freeze({
        locator: createEvidenceLocator(finalLocator),
        headingPath: currentHeadingPath,
        blockLabel,
        blockLabelSource,
        text,
        startLine: currentBlockStartLine,
        endLine
      })
    );

    currentBlockLines = [];
    currentBlockStartLine = 0;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    // Check fenced code block
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (!inCodeBlock && fenceMatch) {
      if (currentBlockLines.length === 0) {
        currentBlockStartLine = lineNumber;
      }
      inCodeBlock = true;
      codeBlockMarker = fenceMatch[1][0];
      currentBlockLines.push(line);
      continue;
    } else if (inCodeBlock) {
      currentBlockLines.push(line);
      if (fenceMatch && fenceMatch[1][0] === codeBlockMarker) {
        inCodeBlock = false;
      }
      continue;
    }

    // Check ATX heading
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      flushBlock(lineNumber - 1);
      const level = headingMatch[1].length;
      const rawText = headingMatch[2].trim();
      let segSlug = slugifyHeading(rawText);

      while (ancestorStack.length > 0 && ancestorStack[ancestorStack.length - 1].level >= level) {
        ancestorStack.pop();
      }

      const parentPath = ancestorStack.map((a) => a.slug).join('/');
      const candidatePath = parentPath ? `${parentPath}/${segSlug}` : segSlug;

      if (seenHeadingPaths.has(candidatePath)) {
        const count = seenHeadingPaths.get(candidatePath)! + 1;
        seenHeadingPaths.set(candidatePath, count);
        segSlug = `${segSlug}-${count}`;
      } else {
        seenHeadingPaths.set(candidatePath, 1);
      }

      ancestorStack.push({ level, slug: segSlug });
      currentHeadingPath = ancestorStack.map((a) => a.slug).join('/');
      unlabeledCount = 0;
      continue;
    }

    // Normal lines
    if (line.trim().length === 0) {
      flushBlock(lineNumber - 1);
    } else {
      if (currentBlockLines.length === 0) {
        currentBlockStartLine = lineNumber;
      }
      currentBlockLines.push(line);
    }
  }

  flushBlock(lines.length);
  return entries;
}
