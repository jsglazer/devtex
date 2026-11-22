/**
 * Mock-HTTP tests for the Better BibTeX JSON-RPC client: a local Node HTTP
 * server on an ephemeral port (never the real BBT port) answers api.ready and
 * item.search, or stalls/refuses to exercise timeout and offline fallback.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { BetterBibTexClient, type JsonRpcTransport, type Scheduler } from './bbt.js';

type Handler = (method: string, params: unknown[], res: ServerResponse) => void;

interface Mock {
  url: string;
  calls: string[];
  close: () => Promise<void>;
}

const servers: Server[] = [];

async function startMock(handler: Handler): Promise<Mock> {
  const calls: string[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      const msg = JSON.parse(body) as { id: number; method: string; params: unknown[] };
      calls.push(msg.method);
      handler(msg.method, msg.params, res);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/better-bibtex/json-rpc`,
    calls,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise<void>((r) => s.close(() => r()));
  }
});

function fetchTransport(url: string): JsonRpcTransport {
  return {
    post: async (body) => {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      return r.text();
    },
  };
}

const realScheduler: Scheduler = {
  now: () => performance.now(),
  schedule: (fn, ms) => setTimeout(fn, ms),
  cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

function reply(res: ServerResponse, result: unknown): void {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
}

describe('BetterBibTexClient', () => {
  it('api.ready returns true when BBT answers', async () => {
    const mock = await startMock((m, _p, res) =>
      reply(res, m === 'api.ready' ? { zotero: '7.0', betterbibtex: '7.0' } : null),
    );
    const c = new BetterBibTexClient(fetchTransport(mock.url), realScheduler);
    expect(await c.ready()).toEqual({ ok: true, value: true });
    expect(mock.calls).toEqual(['api.ready']);
  });

  it('item.search maps CSL items to citekeys and caches per query', async () => {
    const mock = await startMock((_m, params, res) =>
      reply(res, [
        {
          citekey: 'angrist2009',
          title: 'Mostly Harmless Econometrics',
          author: [{ family: 'Angrist', given: 'J.' }],
          issued: { 'date-parts': [[2009]] },
        },
        { citationKey: 'imbens2015', title: 'Causal Inference', author: [{ family: 'Imbens' }] },
        { title: 'no key: dropped' },
        { query: params[0] },
      ]),
    );
    const c = new BetterBibTexClient(fetchTransport(mock.url), realScheduler);
    const r = await c.search('causal');
    expect(r).toEqual({
      ok: true,
      value: [
        {
          citekey: 'angrist2009',
          title: 'Mostly Harmless Econometrics',
          author: 'Angrist',
          year: '2009',
        },
        { citekey: 'imbens2015', title: 'Causal Inference', author: 'Imbens', year: '' },
      ],
    });
    await c.search('Causal ');
    expect(mock.calls).toEqual(['item.search']); // second call served from cache
    expect(c.cached('causal')).toHaveLength(2);
  });

  it('JSON-RPC errors are reported without entering offline back-off', async () => {
    const mock = await startMock((_m, _p, res) =>
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: 'bad method' } })),
    );
    const c = new BetterBibTexClient(fetchTransport(mock.url), realScheduler);
    expect(await c.search('x')).toEqual({ ok: false, reason: 'error', message: 'bad method' });
    expect(c.isOffline()).toBe(false);
  });

  it('times out after 300 ms when Zotero hangs, then backs off without calling', async () => {
    const mock = await startMock(() => {
      /* never answer */
    });
    const c = new BetterBibTexClient(fetchTransport(mock.url), realScheduler);
    const t0 = performance.now();
    const r = await c.search('slow');
    const elapsed = performance.now() - t0;
    expect(r).toMatchObject({ ok: false, reason: 'timeout' });
    expect(elapsed).toBeGreaterThanOrEqual(290);
    expect(elapsed).toBeLessThan(1000);
    expect(c.isOffline()).toBe(true);
    const again = await c.search('slow2');
    expect(again).toMatchObject({ ok: false, reason: 'offline' });
    expect(mock.calls).toEqual(['item.search']);
  });

  it('Zotero closed (connection refused) falls back to offline quickly', async () => {
    const mock = await startMock(() => undefined);
    const url = mock.url;
    await mock.close();
    const c = new BetterBibTexClient(fetchTransport(url), realScheduler);
    const t0 = performance.now();
    const r = await c.ready();
    expect(r).toMatchObject({ ok: false, reason: 'offline' });
    expect(performance.now() - t0).toBeLessThan(300);
  });

  it('back-off expires on the injected clock', async () => {
    let now = 0;
    const sched: Scheduler = { ...realScheduler, now: () => now };
    let fail = true;
    const transport: JsonRpcTransport = {
      post: () =>
        fail
          ? Promise.reject(new Error('ECONNREFUSED'))
          : Promise.resolve('{"jsonrpc":"2.0","id":1,"result":true}'),
    };
    const c = new BetterBibTexClient(transport, sched, { backoffMs: 5000 });
    expect((await c.ready()).ok).toBe(false);
    fail = false;
    now = 4999;
    expect(await c.ready()).toMatchObject({ ok: false, reason: 'offline' });
    now = 5001;
    expect(await c.ready()).toEqual({ ok: true, value: true });
  });
});
