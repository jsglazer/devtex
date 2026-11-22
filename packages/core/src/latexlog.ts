/**
 * LaTeX / latexmk log parser.
 *
 * Ported from LaTeX Workshop, src/parse/parser/latexlog.ts
 * (https://github.com/James-Yu/LaTeX-Workshop), MIT License,
 * Copyright (c) 2016 James Yu. Changes: VS Code / path / configuration
 * dependencies removed; state is local to each call (no module-level buffer);
 * paths are POSIX and resolved against the root's folder; bad-box reporting is
 * an explicit option.
 */
import { dirname, joinPath } from './text.js';

export type LogSeverity = 'error' | 'warning' | 'info' | 'typesetting';

export interface LogEntry {
  type: LogSeverity;
  /** Absolute (or root-relative when root is relative) path of the source file. */
  file: string;
  line: number;
  text: string;
  errorPosText?: string;
}

export interface LogParseOptions {
  badBoxes?: 'both' | 'overfull' | 'underfull' | 'none';
}

const latexError = /^(?!.*ignored error)(?:(.*):(\d+):|!)(?:\s?(.+) [Ee]rror:)? (.+?)$/;
const latexOverfullBox = /^(Overfull \\[vh]box \([^)]*\)) in paragraph at lines (\d+)--(\d+)$/;
const latexOverfullBoxAlt = /^(Overfull \\[vh]box \([^)]*\)) detected at line (\d+)$/;
const latexOverfullBoxOutput =
  /^(Overfull \\[vh]box \([^)]*\)) has occurred while \\output is active(?: \[(\d+)\])?/;
const latexUnderfullBox = /^(Underfull \\[vh]box \([^)]*\)) in paragraph at lines (\d+)--(\d+)$/;
const latexUnderfullBoxAlt = /^(Underfull \\[vh]box \([^)]*\)) detected at line (\d+)$/;
const latexUnderfullBoxOutput =
  /^(Underfull \\[vh]box \([^)]*\)) has occurred while \\output is active(?: \[(\d+)\])?/;
const latexInfo =
  /^((?:(?:Class|Package|Module) \S*)|LaTeX(?: \S*)?|LaTeX3) (Info):\s+(.*?)(?: on(?: input)? line (\d+))?(\.|\?|)$/;
const latexWarn =
  /^((?:(?:Class|Package|Module) \S*)|LaTeX(?: \S*)?|LaTeX3) (Warning):\s+(.*?)(?: on(?: input)? line (\d+))?(\.|\?|)$/;
const latexPackageWarningExtraLines = /^\((.*)\)\s+(.*?)(?: +on input line (\d+))?(\.)?$/;
const latexMissChar = /^\s*(Missing character:.*?!)/;
const latexNoPageOutput = /^No pages of output\.$/;
const bibEmpty = /^Empty `thebibliography' environment/;
const biberWarn = /^Biber warning:.*WARN - I didn't find a database entry for '([^']+)'/;
const UNDEFINED_REFERENCE =
  /^LaTeX Warning: (Reference|Citation) `(.*?)' on page (?:\d+) undefined on input line (\d+).$/;
const messageLine = /^l\.\d+\s(\.\.\.)?(.*)$/;

interface ParserState {
  searchEmptyLine: boolean;
  insideBoxWarn: boolean;
  insideError: boolean;
  currentResult: LogEntry | null;
  nested: number;
  rootFile: string;
  rootDir: string;
  fileStack: string[];
  out: LogEntry[];
  badBoxes: NonNullable<LogParseOptions['badBoxes']>;
}

function push(state: ParserState): void {
  if (state.currentResult !== null) state.out.push(state.currentResult);
}

function setResult(state: ParserState, r: LogEntry): void {
  push(state);
  state.currentResult = r;
}

export function parseLatexLog(
  log: string,
  rootFile: string,
  opts: LogParseOptions = {},
): LogEntry[] {
  const state: ParserState = {
    searchEmptyLine: false,
    insideBoxWarn: false,
    insideError: false,
    currentResult: null,
    nested: 0,
    rootFile,
    rootDir: dirname(rootFile),
    fileStack: [rootFile],
    out: [],
    badBoxes: opts.badBoxes ?? 'none',
  };
  for (const line of log.replace(/\r\n/g, '\n').split('\n')) parseLine(line, state);
  if (state.currentResult !== null && !bibEmpty.test(state.currentResult.text))
    state.out.push(state.currentResult);
  return state.out;
}

function currentFile(state: ParserState): string {
  const top = state.fileStack[state.fileStack.length - 1] ?? state.rootFile;
  return joinPath(state.rootDir, top);
}

function parseLine(line: string, state: ParserState): void {
  const filename = currentFile(state);
  if (state.insideBoxWarn) {
    state.insideBoxWarn = false;
    return;
  }
  const cur = state.currentResult;
  if (state.searchEmptyLine && cur !== null) {
    if (line.trim() === '' || (state.insideError && /^\s/.test(line))) {
      cur.text += '\n';
      state.searchEmptyLine = false;
      state.insideError = false;
    } else {
      const extra = latexPackageWarningExtraLines.exec(line);
      if (extra) {
        cur.text += `\n(${extra[1] ?? ''})\t${extra[2] ?? ''}${extra[4] !== undefined ? '.' : ''}`;
        cur.line = extra[3] !== undefined ? Number.parseInt(extra[3], 10) : 1;
      } else if (state.insideError) {
        const m = messageLine.exec(line);
        if (m && m[2] !== undefined) {
          cur.errorPosText = m[2];
          state.searchEmptyLine = false;
          state.insideError = false;
        } else {
          cur.text += `\n${line}`;
        }
      } else {
        cur.text += `\n${line}`;
      }
    }
    return;
  }
  if (parseUndefinedReference(line, filename, state)) return;
  if (parseBadBox(line, filename, state)) return;

  let r = latexNoPageOutput.exec(line);
  if (r) {
    setResult(state, { type: 'error', file: filename, line: 1, text: r[0] });
    state.searchEmptyLine = true;
    state.insideError = true;
    return;
  }
  r = latexMissChar.exec(line);
  if (r) {
    setResult(state, { type: 'warning', file: filename, line: 1, text: r[1] ?? '' });
    state.searchEmptyLine = false;
    return;
  }
  r = latexInfo.exec(line);
  if (r) {
    setResult(state, {
      type: 'info',
      file: filename,
      line: r[4] !== undefined ? Number.parseInt(r[4], 10) : 1,
      text: `${r[1] ?? ''}: ${r[3] ?? ''}${r[5] ?? ''}`,
    });
    state.searchEmptyLine = true;
    return;
  }
  r = latexWarn.exec(line);
  if (r) {
    setResult(state, {
      type: 'warning',
      file: filename,
      line: r[4] !== undefined ? Number.parseInt(r[4], 10) : 1,
      text: `${r[1] ?? ''}: ${r[3] ?? ''}${r[5] ?? ''}`,
    });
    state.searchEmptyLine = true;
    return;
  }
  r = biberWarn.exec(line);
  if (r) {
    setResult(state, {
      type: 'warning',
      file: '',
      line: 1,
      text: `No bib entry found for '${r[1] ?? ''}'`,
    });
    state.searchEmptyLine = false;
    parseLine(line.substring(r[0].length), state);
    return;
  }
  r = latexError.exec(line);
  if (r) {
    setResult(state, {
      type: 'error',
      text: r[3] !== undefined && r[3] !== 'LaTeX' ? `${r[3]}: ${r[4] ?? ''}` : (r[4] ?? ''),
      file: r[1] !== undefined ? joinPath(state.rootDir, r[1]) : filename,
      line: r[2] !== undefined ? Number.parseInt(r[2], 10) : 1,
    });
    state.searchEmptyLine = true;
    state.insideError = true;
    return;
  }
  state.nested = parseFileStack(line, state.fileStack, state.nested);
  if (state.fileStack.length === 0) state.fileStack.push(state.rootFile);
}

function parseUndefinedReference(line: string, filename: string, state: ParserState): boolean {
  if (line === 'LaTeX Warning: There were undefined references.') return true;
  const m = UNDEFINED_REFERENCE.exec(line);
  if (!m) return false;
  setResult(state, {
    type: 'warning',
    file: filename,
    line: m[3] !== undefined ? Number.parseInt(m[3], 10) : 1,
    text: `Cannot find ${(m[1] ?? '').toLowerCase()} \`${m[2] ?? ''}\`.`,
    errorPosText: m[2] ?? '',
  });
  state.searchEmptyLine = false;
  return true;
}

function parseBadBox(line: string, filename: string, state: ParserState): boolean {
  const type = state.badBoxes;
  if (type === 'none') return false;
  const regexs: RegExp[] = [];
  if (type === 'both' || type === 'overfull')
    regexs.push(latexOverfullBox, latexOverfullBoxAlt, latexOverfullBoxOutput);
  if (type === 'both' || type === 'underfull')
    regexs.push(latexUnderfullBox, latexUnderfullBoxAlt, latexUnderfullBoxOutput);
  for (const regex of regexs) {
    const r = regex.exec(line);
    if (!r) continue;
    if (regex === latexOverfullBoxOutput || regex === latexUnderfullBoxOutput) {
      setResult(state, {
        type: 'typesetting',
        file: filename,
        line: 1,
        text: r[2] !== undefined ? `${r[1] ?? ''} in page ${r[2]}` : (r[1] ?? ''),
      });
      parseLine(line.substring(r[0].length), state);
    } else {
      setResult(state, {
        type: 'typesetting',
        file: filename,
        line: Number.parseInt(r[2] ?? '1', 10),
        text: r[1] ?? '',
      });
      state.insideBoxWarn = true;
      state.searchEmptyLine = false;
    }
    return true;
  }
  return false;
}

function parseFileStack(line: string, fileStack: string[], nested: number): number {
  const r = /(\(|\))/.exec(line);
  if (r && r.index > -1) {
    const rest = line.substring(r.index + 1);
    if (r[1] === '(') {
      const pathResult = /^"?((?:(?:[a-zA-Z]:|\.|\/)?(?:\/|\\\\?))[^"()[\]]*)/.exec(rest);
      const mikTeXPathResult = /^"?([^"()[\]]*\.[a-z]{3,})/.exec(rest);
      if (pathResult?.[1] !== undefined) fileStack.push(pathResult[1].trim());
      else if (mikTeXPathResult?.[1] !== undefined)
        fileStack.push(`./${mikTeXPathResult[1].trim()}`);
      else nested += 1;
    } else if (nested > 0) {
      nested -= 1;
    } else {
      fileStack.pop();
    }
    return parseFileStack(rest, fileStack, nested);
  }
  return nested;
}
