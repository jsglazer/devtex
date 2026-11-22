/**
 * Better BibTeX JSON-RPC client (api.ready, item.search). Transport is
 * injected: on macOS the shell forwards the request to a Rust command bound
 * to the local BBT endpoint; tests use a mock HTTP server. Every call has a
 * hard timeout (300 ms by default) and failures put the client into a short
 * offline back-off so typing never waits on Zotero. Results are cached in
 * memory. Callers fall back to the project's .bib entries when offline.
 */

export interface JsonRpcTransport {
  /**
   * POST a JSON-RPC body; resolve with the response body text. `timeoutMs`
   * is advisory for the transport; the client enforces it independently.
   */
  post(body: string, timeoutMs: number): Promise<string>;
}

export interface Scheduler {
  now(): number;
  schedule(fn: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
}

export interface BbtItem {
  citekey: string;
  title: string;
  author: string;
  year: string;
}

export type BbtResult<T> =
  { ok: true; value: T } | { ok: false; reason: 'offline' | 'timeout' | 'error'; message: string };

export interface BbtOptions {
  timeoutMs?: number;
  /** After a failure, skip calls for this long (ms). */
  backoffMs?: number;
}

interface RpcResponse {
  result?: unknown;
  error?: { message?: string };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

function itemFrom(raw: unknown): BbtItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const citekey = str(r['citekey']) || str(r['citationKey']) || str(r['citation-key']);
  if (citekey === '') return null;
  let author = '';
  const a = r['author'];
  if (Array.isArray(a) && a.length > 0) {
    const first: unknown = a[0];
    if (typeof first === 'object' && first !== null) {
      const f = first as Record<string, unknown>;
      author = str(f['family']) || str(f['literal']) || str(f['lastName']);
    }
  }
  let year = '';
  const issued = r['issued'];
  if (typeof issued === 'object' && issued !== null) {
    const dp = (issued as Record<string, unknown>)['date-parts'];
    if (Array.isArray(dp) && Array.isArray(dp[0])) year = str((dp[0] as unknown[])[0]);
  }
  return { citekey, title: str(r['title']), author, year };
}

export class BetterBibTexClient {
  private id = 0;
  private offlineUntil = -Infinity;
  private readonly cache = new Map<string, BbtItem[]>();
  private readonly timeoutMs: number;
  private readonly backoffMs: number;

  constructor(
    private readonly transport: JsonRpcTransport,
    private readonly scheduler: Scheduler,
    opts: BbtOptions = {},
  ) {
    this.timeoutMs = opts.timeoutMs ?? 300;
    this.backoffMs = opts.backoffMs ?? 10_000;
  }

  /** True while in back-off after a failure. */
  isOffline(): boolean {
    return this.scheduler.now() < this.offlineUntil;
  }

  private async call(method: string, params: unknown[]): Promise<BbtResult<unknown>> {
    if (this.isOffline())
      return { ok: false, reason: 'offline', message: 'Better BibTeX unavailable (back-off)' };
    const body = JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params });
    let timedOut = false;
    let timer: unknown;
    try {
      const text = await new Promise<string>((resolve, reject) => {
        timer = this.scheduler.schedule(() => {
          timedOut = true;
          reject(new Error('timeout'));
        }, this.timeoutMs);
        this.transport.post(body, this.timeoutMs).then(resolve, reject);
      });
      const parsed = JSON.parse(text) as RpcResponse;
      if (parsed.error !== undefined) {
        return { ok: false, reason: 'error', message: parsed.error.message ?? 'JSON-RPC error' };
      }
      return { ok: true, value: parsed.result };
    } catch (e) {
      this.offlineUntil = this.scheduler.now() + this.backoffMs;
      if (timedOut)
        return { ok: false, reason: 'timeout', message: `No reply within ${this.timeoutMs} ms` };
      return { ok: false, reason: 'offline', message: e instanceof Error ? e.message : String(e) };
    } finally {
      this.scheduler.cancel(timer);
    }
  }

  async ready(): Promise<BbtResult<boolean>> {
    const r = await this.call('api.ready', []);
    if (!r.ok) return r;
    return { ok: true, value: r.value !== null && r.value !== undefined && r.value !== false };
  }

  /** Search the Zotero library; results cached per query. */
  async search(terms: string): Promise<BbtResult<BbtItem[]>> {
    const key = terms.trim().toLowerCase();
    const hit = this.cache.get(key);
    if (hit !== undefined) return { ok: true, value: hit };
    const r = await this.call('item.search', [terms]);
    if (!r.ok) return r;
    const items = Array.isArray(r.value)
      ? r.value.map(itemFrom).filter((i): i is BbtItem => i !== null)
      : [];
    this.cache.set(key, items);
    return { ok: true, value: items };
  }

  /** Cached results only (never waits): used while typing. */
  cached(terms: string): BbtItem[] | undefined {
    return this.cache.get(terms.trim().toLowerCase());
  }
}
