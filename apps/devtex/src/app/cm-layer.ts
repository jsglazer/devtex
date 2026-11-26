/**
 * Puts CodeMirror's injected styles into `@layer cm`, the lowest cascade
 * layer (styles.css declares `@layer cm, base, profile, user`).
 *
 * CodeMirror (style-mod) adds its theme rules with `insertRule` on a
 * constructed stylesheet in `document.adoptedStyleSheets`. Unlayered rules
 * beat every layered rule whatever their specificity, so without this a
 * profile's `.cm-…` rule could never win against CodeMirror's own theme.
 * Only constructed sheets (no owner `<style>`/`<link>`) are affected; the
 * profile, user.css and pdf.js sheets are all element-owned.
 */

export const CM_LAYER = 'cm';

/** `rule` wrapped in the given layer; `@layer`/`@import`/`@charset`/`@namespace` rules are left alone. */
export function layeredRule(rule: string, layer = CM_LAYER): string {
  return /^\s*@(layer|import|charset|namespace)\b/i.test(rule)
    ? rule
    : `@layer ${layer} { ${rule} }`;
}

let installed = false;

/** Install once, before the first EditorView is created. */
export function layerCodeMirrorStyles(proto: CSSStyleSheet = CSSStyleSheet.prototype): void {
  if (installed) return;
  installed = true;
  const insert = Object.getOwnPropertyDescriptor(proto, 'insertRule')?.value as
    ((this: CSSStyleSheet, rule: string, index?: number) => number) | undefined;
  if (insert === undefined) return;
  proto.insertRule = function (this: CSSStyleSheet, rule: string, index?: number): number {
    const constructed = this.ownerNode === null && this.ownerRule === null;
    return insert.call(this, constructed ? layeredRule(rule) : rule, index);
  };
}
