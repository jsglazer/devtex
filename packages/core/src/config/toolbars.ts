/**
 * toolbars.json: customizable show/hide menu bars, each holding any command.
 */
import { parseJsoncText, type Loaded } from './settings.js';

export interface ToolbarItem {
  command: string;
  /** Button label; defaults to the command id. */
  label?: string;
}

export interface Toolbar {
  id: string;
  title: string;
  visible: boolean;
  items: ToolbarItem[];
}

export const DEFAULT_TOOLBARS: Toolbar[] = [
  {
    id: 'main',
    title: 'Main',
    visible: true,
    items: [
      { command: 'file.openProject', label: 'Open' },
      { command: 'file.save', label: 'Save' },
      { command: 'compile.pdf', label: 'PDF' },
      { command: 'pane.togglePreview', label: 'Preview' },
      { command: 'pane.togglePdf', label: 'PDF view' },
      { command: 'pane.toggleOutline', label: 'Outline' },
      { command: 'pane.toggleProblems', label: 'Problems' },
      { command: 'git.pushReview', label: 'Push' },
    ],
  },
  {
    id: 'format',
    title: 'Format',
    visible: true,
    items: [
      { command: 'format.bold', label: 'B' },
      { command: 'format.italic', label: 'I' },
      { command: 'format.emph', label: 'Emph' },
      { command: 'format.texttt', label: 'TT' },
      { command: 'palette.sectioning', label: 'Section' },
      { command: 'palette.environments', label: 'Env' },
      { command: 'palette.size', label: 'Size' },
      { command: 'palette.alignment', label: 'Align' },
    ],
  },
];

export function loadToolbars(
  text: string | null,
  knownCommands?: ReadonlySet<string>,
): Loaded<Toolbar[]> {
  const errors: string[] = [];
  if (text === null) return { value: DEFAULT_TOOLBARS, errors };
  const raw = parseJsoncText(text, 'toolbars.json', errors);
  if (raw === undefined) return { value: DEFAULT_TOOLBARS, errors };
  if (!Array.isArray(raw)) {
    errors.push('toolbars.json: expected an array of toolbars (using defaults)');
    return { value: DEFAULT_TOOLBARS, errors };
  }
  const out: Toolbar[] = [];
  const ids = new Set<string>();
  raw.forEach((t: unknown, i) => {
    if (typeof t !== 'object' || t === null) {
      errors.push(`toolbars.json[${i}]: expected an object`);
      return;
    }
    const r = t as Record<string, unknown>;
    const id = typeof r['id'] === 'string' ? r['id'] : `toolbar${i}`;
    if (ids.has(id)) {
      errors.push(`toolbars.json[${i}]: duplicate id ${id}`);
      return;
    }
    ids.add(id);
    const items: ToolbarItem[] = [];
    const rawItems = Array.isArray(r['items']) ? (r['items'] as unknown[]) : [];
    rawItems.forEach((it, k) => {
      const cmd =
        typeof it === 'string'
          ? it
          : typeof it === 'object' && it !== null
            ? (it as Record<string, unknown>)['command']
            : undefined;
      if (typeof cmd !== 'string') {
        errors.push(`toolbars.json[${i}].items[${k}]: missing command`);
        return;
      }
      if (knownCommands !== undefined && !knownCommands.has(cmd)) {
        errors.push(`toolbars.json[${i}].items[${k}]: unknown command ${cmd}`);
        return;
      }
      const label =
        typeof it === 'object' && it !== null
          ? (it as Record<string, unknown>)['label']
          : undefined;
      items.push(typeof label === 'string' ? { command: cmd, label } : { command: cmd });
    });
    out.push({
      id,
      title: typeof r['title'] === 'string' ? r['title'] : id,
      visible: typeof r['visible'] === 'boolean' ? r['visible'] : true,
      items,
    });
  });
  return { value: out, errors };
}
