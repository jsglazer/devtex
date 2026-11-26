import { App } from './app/app.js';
import { layerCodeMirrorStyles } from './app/cm-layer.js';
import { tauriShell } from './shell/tauri.js';

// before the editor mounts its theme: CodeMirror's styles go to the lowest layer
layerCodeMirrorStyles();

const app = new App(tauriShell);
app.start().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  document.body.insertAdjacentHTML(
    'afterbegin',
    `<pre class="dt-fatal">DevTex failed to start: ${msg.replace(/</g, '&lt;')}</pre>`,
  );
});
