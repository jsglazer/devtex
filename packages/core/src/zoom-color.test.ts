import { describe, expect, it } from 'vitest';
import { formatCssColor, parseCssColor, toHex6, withPickedRgb } from './config/color.js';
import { DEFAULT_SETTINGS, loadSettings } from './config/settings.js';
import { DEFAULT_TOOLBARS } from './config/toolbars.js';
import { isReserved, loadKeymap } from './config/keymap.js';
import { clampZoom, formatZoom, stepZoom } from './zoom.js';

describe('zoom steps', () => {
  it('steps up and down through the fixed ladder', () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(1.05, 1)).toBe(1.1);
    expect(stepZoom(1.05, -1)).toBe(1);
  });
  it('stops at the limits', () => {
    expect(stepZoom(4, 1)).toBe(4);
    expect(stepZoom(0.5, -1)).toBe(0.5);
    expect(stepZoom(3, 1, 0.5, 3)).toBe(3);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(formatZoom(1.25)).toBe('125%');
  });
});

describe('colour picker helpers', () => {
  it('parses hex and rgb()/rgba() forms', () => {
    expect(parseCssColor('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(parseCssColor('#11223380')).toEqual({ r: 17, g: 34, b: 51, a: 0.502 });
    expect(parseCssColor('rgba(80, 200, 120, 0.35)')).toEqual({ r: 80, g: 200, b: 120, a: 0.35 });
    expect(parseCssColor('rgb(10 20 30 / 50%)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseCssColor('red')).toBeNull();
    expect(parseCssColor('rgba(1,2)')).toBeNull();
  });
  it('formats opaque colours as hex and translucent ones as rgba', () => {
    expect(toHex6({ r: 255, g: 0, b: 16 })).toBe('#ff0010');
    expect(formatCssColor({ r: 1, g: 2, b: 3, a: 1 })).toBe('#010203');
    expect(formatCssColor({ r: 1, g: 2, b: 3, a: 0.256 })).toBe('rgba(1, 2, 3, 0.26)');
  });
  it('a picked colour keeps the existing alpha', () => {
    expect(withPickedRgb('rgba(80, 200, 120, 0.35)', '#ff0000')).toBe('rgba(255, 0, 0, 0.35)');
    expect(withPickedRgb('#00ff00', '#0000ff')).toBe('#0000ff');
    expect(withPickedRgb('red', '#0000ff')).toBe('#0000ff');
    expect(withPickedRgb('#00ff00', 'nonsense')).toBe('#00ff00');
  });
  it('every default highlight colour is parseable by the picker', () => {
    for (const c of Object.values(DEFAULT_SETTINGS.colors)) expect(parseCssColor(c)).not.toBeNull();
  });
});

describe('Update001 defaults', () => {
  it('the main toolbar has a Compile button', () => {
    const main = DEFAULT_TOOLBARS.find((t) => t.id === 'main');
    expect(main?.items).toContainEqual({ command: 'compile.pdf', label: 'Compile' });
  });
  it('⌘= / ⌘− / ⌘0 zoom bindings are unreserved defaults', () => {
    const map = new Map(loadKeymap(null).value.bindings.map((b) => [b.key, b.command]));
    expect(map.get('Cmd-=')).toBe('view.zoomIn');
    expect(map.get('Cmd--')).toBe('view.zoomOut');
    expect(map.get('Cmd-0')).toBe('view.zoomReset');
    expect(isReserved('Mod-=')).toBe(false);
  });
  it('ui.zoom defaults to 1 and is range-checked', () => {
    expect(DEFAULT_SETTINGS.ui.zoom).toBe(1);
    expect(loadSettings('{ "ui": { "zoom": 1.25 } }').value.ui.zoom).toBe(1.25);
    const bad = loadSettings('{ "ui": { "zoom": 9 } }');
    expect(bad.value.ui.zoom).toBe(1);
    expect(bad.errors[0]).toContain('ui.zoom');
  });
});
