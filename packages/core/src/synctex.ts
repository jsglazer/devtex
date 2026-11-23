/**
 * Pure TypeScript SyncTeX parser with forward (source -> PDF) and inverse
 * (PDF -> source) search. No synctex CLI.
 *
 * Ported from LaTeX Workshop (https://github.com/James-Yu/LaTeX-Workshop),
 * src/locate/synctex/synctexjs.ts and src/locate/synctex/worker.ts, MIT
 * License, Copyright (c) 2016 James Yu; synctexjs.ts is itself derived from
 * synctex-js (https://github.com/tdurieux/synctex-js), MIT License,
 * Copyright (c) 2018 Thomas Durieux. Changes: VS Code, fs, iconv and zlib
 * removed (gunzip via fflate, path resolution is POSIX and injected by the
 * caller); console logging dropped; strict types.
 */
import { gunzipSync, strFromU8 } from 'fflate';
import { joinPath, normalizePath } from './text.js';

export interface SyncBlock {
  type: string;
  parent: SyncBlock | SyncPage;
  fileNumber: number;
  file: { path: string } | undefined;
  line: number;
  left: number;
  bottom: number;
  width: number | undefined;
  height: number;
  depth?: number;
  blocks?: SyncBlock[];
  elements?: SyncBlock[];
  page: number;
}

export interface SyncPage {
  page: number;
  blocks: SyncBlock[];
  type: 'page';
}

type LinePageBlocks = Map<number, Map<number, SyncBlock[]>>;

export interface SyncTexData {
  offset: { x: number; y: number };
  version: string;
  files: Map<string, { path: string }>;
  /** input path (as recorded) -> line -> page -> elements */
  blockNumberLine: Map<string, LinePageBlocks>;
  numberPages: number;
}

function isBlock(b: SyncBlock | SyncPage): b is SyncBlock {
  return b.type !== 'page';
}

export function decodeSyncTex(bytes: Uint8Array): string {
  const gz = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  // latin1 ("binary") mirrors LaTeX Workshop; paths are re-matched by the caller.
  return strFromU8(gz ? gunzipSync(bytes) : bytes, true);
}

export function parseSyncTex(body: string): SyncTexData {
  const unit = 65781.76;
  let numberPages = 0;
  let currentPage: SyncPage | undefined;
  let currentElement: SyncBlock | SyncPage | undefined;
  const data: SyncTexData = {
    offset: { x: 0, y: 0 },
    version: '',
    files: new Map(),
    blockNumberLine: new Map(),
    numberPages: 0,
  };
  const lines = body.split('\n');
  data.version = (lines[0] ?? '').replace('SyncTeX Version:', '');

  const inputPattern = /Input:([0-9]+):(.+)/;
  const offsetPattern = /(X|Y) Offset:([0-9]+)/;
  const openPagePattern = /\{([0-9]+)$/;
  const closePagePattern = /\}([0-9]+)$/;
  const vBlock = /\[([0-9]+),([0-9]+):(-?[0-9]+),(-?[0-9]+):(-?[0-9]+),(-?[0-9]+),(-?[0-9]+)/;
  const closeV = /\]$/;
  const hBlock = /\(([0-9]+),([0-9]+):(-?[0-9]+),(-?[0-9]+):(-?[0-9]+),(-?[0-9]+),(-?[0-9]+)/;
  const closeH = /\)$/;
  const element = /(.)([0-9]+),([0-9]+):(-?[0-9]+),(-?[0-9]+)(:?(-?[0-9]+))?/;

  const closeBlock = (): void => {
    if (currentElement !== undefined && isBlock(currentElement)) {
      const parent = currentElement.parent;
      if (isBlock(parent) && parent.blocks !== undefined) {
        parent.blocks.push(currentElement);
        currentElement = parent;
      } else if (!isBlock(parent)) {
        parent.blocks.push(currentElement);
        currentElement = parent;
      }
    }
  };

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    let m = inputPattern.exec(line);
    if (m?.[1] !== undefined && m[2] !== undefined) {
      data.files.set(m[1], { path: m[2] });
      continue;
    }
    m = offsetPattern.exec(line);
    if (m?.[1] !== undefined && m[2] !== undefined) {
      if (m[1] === 'X') data.offset.x = Number.parseInt(m[2], 10) / unit;
      else data.offset.y = Number.parseInt(m[2], 10) / unit;
      continue;
    }
    m = openPagePattern.exec(line);
    if (m?.[1] !== undefined) {
      currentPage = { page: Number.parseInt(m[1], 10), blocks: [], type: 'page' };
      numberPages = Math.max(numberPages, currentPage.page);
      currentElement = currentPage;
      continue;
    }
    m = closePagePattern.exec(line);
    if (m && currentPage !== undefined) {
      currentPage = undefined;
      continue;
    }
    const vm = vBlock.exec(line) ?? hBlock.exec(line);
    if (vm && (line.startsWith('[') || line.startsWith('('))) {
      if (currentPage === undefined || currentElement === undefined) continue;
      const block: SyncBlock = {
        type: line.startsWith('[') ? 'vertical' : 'horizontal',
        parent: currentElement,
        fileNumber: Number.parseInt(vm[1] ?? '0', 10),
        file: data.files.get(vm[1] ?? ''),
        line: Number.parseInt(vm[2] ?? '0', 10),
        left: Number(vm[3]) / unit,
        bottom: Number(vm[4]) / unit,
        width: Number(vm[5]) / unit,
        height: Number(vm[6]) / unit,
        blocks: [],
        elements: [],
        page: currentPage.page,
      };
      if (line.startsWith('[')) block.depth = Number.parseInt(vm[7] ?? '0', 10);
      currentElement = block;
      continue;
    }
    if (closeV.test(line) || closeH.test(line)) {
      closeBlock();
      continue;
    }
    m = element.exec(line);
    if (m) {
      if (currentPage === undefined || currentElement === undefined || !isBlock(currentElement))
        continue;
      const fileNumber = Number.parseInt(m[2] ?? '0', 10);
      const lineNumber = Number.parseInt(m[3] ?? '0', 10);
      const file = data.files.get(String(fileNumber));
      if (file === undefined) continue;
      const elem: SyncBlock = {
        type: m[1] ?? '',
        parent: currentElement,
        fileNumber,
        file,
        line: lineNumber,
        left: Number(m[4]) / unit,
        bottom: Number(m[5]) / unit,
        // inside a vertical list (glue/kern between paragraphs, \end{frame} …) the
        // parent's height is the whole vbox, often a full page: treat the node as a point
        height: currentElement.type === 'vertical' ? 0 : currentElement.height,
        width: m[7] !== undefined && m[7] !== '' ? Number(m[7]) / unit : undefined,
        page: currentPage.page,
      };
      let byLine = data.blockNumberLine.get(file.path);
      if (byLine === undefined) {
        byLine = new Map();
        data.blockNumberLine.set(file.path, byLine);
      }
      let byPage = byLine.get(lineNumber);
      if (byPage === undefined) {
        byPage = new Map();
        byLine.set(lineNumber, byPage);
      }
      const list = byPage.get(elem.page) ?? [];
      list.push(elem);
      byPage.set(elem.page, list);
      currentElement.elements?.push(elem);
    }
  }
  data.numberPages = numberPages;
  return data;
}

class Rectangle {
  constructor(
    readonly top: number,
    readonly bottom: number,
    readonly left: number,
    readonly right: number,
  ) {}

  include(r: Rectangle): boolean {
    return (
      this.left <= r.left && this.right >= r.right && this.bottom >= r.bottom && this.top <= r.top
    );
  }

  distanceFromCenter(x: number, y: number): number {
    return Math.hypot((this.left + this.right) / 2 - x, (this.bottom + this.top) / 2 - y);
  }
}

function blockRect(b: SyncBlock): Rectangle {
  const right = b.width !== undefined && b.width !== 0 ? b.left + b.width : b.left;
  return new Rectangle(b.bottom - b.height, b.bottom, b.left, right);
}

function blocksRect(blocks: readonly SyncBlock[]): Rectangle {
  let top = 2e16;
  let bottom = 0;
  let left = 2e16;
  let right = 0;
  for (const b of blocks) {
    if (b.elements !== undefined || b.type === 'k' || b.type === 'r') continue;
    bottom = Math.max(b.bottom, bottom);
    top = Math.min(b.bottom - b.height, top);
    left = Math.min(b.left, left);
    if (b.width !== undefined) right = Math.max(b.left + b.width, right);
  }
  return new Rectangle(top, bottom, left, right);
}

function firstPageBlocks(byPage: Map<number, SyncBlock[]> | undefined): SyncBlock[] {
  if (byPage === undefined) return [];
  const pages = [...byPage.keys()].sort((a, b) => a - b);
  const p = pages[0];
  return p === undefined ? [] : (byPage.get(p) ?? []);
}

export interface PdfLocation {
  page: number;
  /** PDF points from the left edge. */
  x: number;
  /** PDF points from the TOP edge (SyncTeX convention). */
  y: number;
  /** Highlight rectangle (same units), when known. */
  rect?: { left: number; top: number; right: number; bottom: number };
}

export interface SourceLocation {
  /** Input path as recorded in the .synctex file, resolved against baseDir. */
  file: string;
  line: number;
}

/**
 * Find the recorded input path that matches `file`. Recorded paths are
 * relative to latexmk's working directory (`baseDir`) or absolute.
 */
export function matchInputPath(
  data: SyncTexData,
  file: string,
  baseDir: string,
): string | undefined {
  const target = normalizePath(file);
  for (const p of data.blockNumberLine.keys()) {
    if (joinPath(baseDir, p) === target) return p;
  }
  return undefined;
}

/** Forward search: source (file, line) -> PDF location. */
export function syncToPdf(
  data: SyncTexData,
  file: string,
  line: number,
  baseDir: string,
): PdfLocation | undefined {
  const input = matchInputPath(data, file, baseDir);
  if (input === undefined) return undefined;
  const byLine = data.blockNumberLine.get(input);
  if (byLine === undefined) return undefined;
  const lineNums = [...byLine.keys()].sort((a, b) => a - b);
  let i = lineNums.findIndex((x) => x >= line);
  if (i === -1) i = lineNums.length - 1;
  const l1 = lineNums[i];
  if (l1 === undefined) return undefined;
  const blocks1 = firstPageBlocks(byLine.get(l1));
  const b1 = blocks1[0];
  if (b1 === undefined) return undefined;
  const c1 = blocksRect(blocks1);
  const rect = {
    left: c1.left + data.offset.x,
    top: c1.top + data.offset.y,
    right: c1.right + data.offset.x,
    bottom: c1.bottom + data.offset.y,
  };
  if (i === 0 || l1 === line || l1 < line) {
    return { page: b1.page, x: c1.left + data.offset.x, y: c1.bottom + data.offset.y, rect };
  }
  const l0 = lineNums[i - 1] ?? l1;
  const c0 = blocksRect(firstPageBlocks(byLine.get(l0)));
  const bottom =
    c0.bottom < c1.bottom
      ? (c0.bottom * (l1 - line)) / (l1 - l0) + (c1.bottom * (line - l0)) / (l1 - l0)
      : c1.bottom;
  return { page: b1.page, x: c1.left + data.offset.x, y: bottom + data.offset.y, rect };
}

/** Inverse search: PDF (page, x, y from top, in points) -> source location. */
export function syncToSource(
  data: SyncTexData,
  page: number,
  x: number,
  y: number,
  baseDir: string,
): SourceLocation | undefined {
  const x0 = x - data.offset.x;
  const y0 = y - data.offset.y;
  let best: { input: string; line: number; dist: number; rect: Rectangle } | undefined;
  for (const [input, byLine] of data.blockNumberLine) {
    for (const [lineNum, byPage] of byLine) {
      const blocks = byPage.get(page);
      if (blocks === undefined) continue;
      for (const block of blocks) {
        if (block.elements !== undefined || block.type === 'k' || block.type === 'r') continue;
        const rect = blockRect(block);
        const dist = rect.distanceFromCenter(x0, y0);
        if (
          best === undefined ||
          best.rect.include(rect) ||
          (dist < best.dist && !rect.include(best.rect))
        ) {
          best = { input, line: lineNum, dist, rect };
        }
      }
    }
  }
  if (best === undefined) return undefined;
  return { file: joinPath(baseDir, best.input), line: best.line };
}
