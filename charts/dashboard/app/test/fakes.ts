// Fake upstreams for the tests: every external service the agent calls, on random local ports.
import { createServer, type Config } from "../agent/server.ts";

// Fakes record whatever JSON they were sent, and tests reach into it freely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Call = { method: string; path: string; query: URLSearchParams; headers: Headers; body: any };
export type Routes = Record<string, (call: Call) => unknown>;

const servers: { stop(force?: boolean): unknown }[] = [];
export const stopFakes = () => {
  for (const s of servers.splice(0)) s.stop(true);
};

export function fake(routes: Routes) {
  const calls: Call[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const text = await req.text();
      const call = {
        method: req.method,
        path: url.pathname,
        query: url.searchParams,
        headers: req.headers,
        body: text ? JSON.parse(text) : undefined,
      };
      calls.push(call);
      const handler = routes[`${req.method} ${url.pathname}`];
      if (!handler) return new Response(`no fake for ${req.method} ${url.pathname}`, { status: 404 });
      const result = await handler(call);
      return result instanceof Response ? result : Response.json(result);
    },
  });
  servers.push(server);
  return {
    url: `http://localhost:${server.port}`,
    calls,
    called: (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path),
  };
}

// Scripted OpenAI: each request gets the next scripted stream, or an HTTP status to fail with.
export type OpenAIEvent = Record<string, unknown>;
export function fakeOpenAI(script: (OpenAIEvent[] | number)[]) {
  let i = 0;
  return fake({
    "POST /v1/responses": () => {
      const next = script[Math.min(i++, script.length - 1)]!;
      if (typeof next === "number")
        return Response.json({ error: { message: "The server is overloaded" } }, { status: next });
      const body = next.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    },
  });
}

export const reply = (id: string, ...chunks: string[]): OpenAIEvent[] => [
  { type: "response.created", response: { id, status: "in_progress", output: [] } },
  ...chunks.map((delta) => ({ type: "response.output_text.delta", delta })),
  { type: "response.completed", response: { id, status: "completed", output: [{ type: "message" }] } },
];

export const toolCall = (id: string, name: string, args: unknown = {}): OpenAIEvent[] => {
  const item = { type: "function_call", id: `fc_${id}`, call_id: `call_${id}`, name, arguments: JSON.stringify(args) };
  return [
    { type: "response.created", response: { id, status: "in_progress", output: [] } },
    { type: "response.output_item.added", output_index: 0, item: { ...item, arguments: "" } },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: { id, status: "completed", output: [item] } },
  ];
};

export function setup(
  upstreams: {
    openai: ReturnType<typeof fake>;
    sonarr?: Routes;
    radarr?: Routes;
    tmdb?: Routes;
    mdblist?: Routes;
    transmission?: Routes;
    tmdbKey?: string;
  },
  overrides: Partial<Config> = {},
) {
  const sonarr = fake(upstreams.sonarr ?? {});
  const radarr = fake(upstreams.radarr ?? {});
  const tmdb = fake(upstreams.tmdb ?? {});
  const mdblist = fake(upstreams.mdblist ?? {});
  const transmission = fake(upstreams.transmission ?? {});
  const server = createServer({
    port: 0,
    prompt: "test prompt",
    openai: {
      url: `${upstreams.openai.url}/v1`,
      key: "sk-test",
      model: "test-model",
      reasoningEffort: "low",
      prices: { input: 1, cachedInput: 0.1, output: 4, webSearch: 0.01 },
    },
    sonarr: { url: sonarr.url, key: "sonarr-key" },
    radarr: { url: radarr.url, key: "radarr-key" },
    tmdb: { url: tmdb.url, key: upstreams.tmdbKey ?? "tmdb-v3-key" },
    mdblist: { url: mdblist.url, key: "mdb-key" },
    transmission: { url: `${transmission.url}/transmission/rpc` },
    maxToolRounds: 8,
    keepAliveMs: 1_000,
    pollMs: 5,
    commandTimeoutMs: 2_000,
    retryDelaysMs: [5, 5],
    ...overrides,
  });
  servers.push(server);
  const chat = async (body: unknown) => {
    const res = await fetch(`http://localhost:${server.port}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return parseSSE(await res.text());
  };
  return {
    chat,
    url: `http://localhost:${server.port}`,
    openai: upstreams.openai,
    sonarr,
    radarr,
    tmdb,
    mdblist,
    transmission,
  };
}

function parseSSE(text: string) {
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((frame) => {
      const [eventLine, dataLine] = frame.split("\n");
      return { event: eventLine!.slice("event: ".length), data: JSON.parse(dataLine!.slice("data: ".length)) };
    });
}

// What the server sent back to OpenAI as the result of the n-th tool call.
export const toolOutput = (openai: ReturnType<typeof fake>, request: number) =>
  JSON.parse(openai.called("POST", "/v1/responses")[request]!.body.input[0].output);
