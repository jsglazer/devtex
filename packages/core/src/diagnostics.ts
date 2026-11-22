/**
 * In-editor diagnostics engine: unbalanced brackets, mismatched
 * \begin/\end, undefined \ref, unknown citekeys. latexmk log entries
 * supplement these on macOS (see latexlog.ts).
 */
import { analyzeStructure } from './matching.js';
import { maskNonCode } from './text.js';

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  from: number;
  to: number;
  severity: Severity;
  message: string;
  source: 'structure' | 'refs' | 'citations' | 'latexmk';
}

export interface DiagnosticsContext {
  /** All labels defined anywhere in the project. */
  labels: ReadonlySet<string>;
  /** Known citekeys, or null when no citation source is available (skip the check). */
  citekeys: ReadonlySet<string> | null;
}

export function diagnose(text: string, ctx: DiagnosticsContext): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const p of analyzeStructure(text).problems) {
    out.push({
      from: p.from,
      to: p.to,
      severity: 'error',
      message: p.message,
      source: 'structure',
    });
  }
  const masked = maskNonCode(text);
  for (const m of masked.matchAll(
    /\\(?:ref|eqref|autoref|cref|Cref|pageref|nameref|vref)\s*\{([^}]*)\}/g,
  )) {
    const argStart = m.index + m[0].indexOf('{') + 1;
    let offset = argStart;
    for (const raw of (m[1] ?? '').split(',')) {
      const label = raw.trim();
      const lead = raw.length - raw.trimStart().length;
      if (label !== '' && !ctx.labels.has(label)) {
        out.push({
          from: offset + lead,
          to: offset + lead + label.length,
          severity: 'warning',
          message: `Undefined reference: ${label}`,
          source: 'refs',
        });
      }
      offset += raw.length + 1;
    }
  }
  if (ctx.citekeys !== null) {
    const keys = ctx.citekeys;
    for (const m of masked.matchAll(
      /\\(?:[a-zA-Z]*cite[a-zA-Z]*|nocite)\*?(?:\s*\[[^\]]*\]){0,2}\s*\{([^}]*)\}/g,
    )) {
      const argStart = m.index + m[0].lastIndexOf('{') + 1;
      let offset = argStart;
      for (const raw of (m[1] ?? '').split(',')) {
        const key = raw.trim();
        const lead = raw.length - raw.trimStart().length;
        if (key !== '' && key !== '*' && !keys.has(key)) {
          out.push({
            from: offset + lead,
            to: offset + lead + key.length,
            severity: 'warning',
            message: `Unknown citekey: ${key}`,
            source: 'citations',
          });
        }
        offset += raw.length + 1;
      }
    }
  }
  return out.sort((a, b) => a.from - b.from);
}
