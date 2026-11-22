import { App } from './app/app.js';
import { tauriShell } from './shell/tauri.js';

const app = new App(tauriShell);
app.start().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  document.body.insertAdjacentHTML(
    'afterbegin',
    `<pre class="dt-fatal">DevTex failed to start: ${msg.replace(/</g, '&lt;')}</pre>`,
  );
});
