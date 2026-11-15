import { runTurn, UserFacingError, type Emit, type Prices } from "./openai.ts";
import { toolDefinitions, runTool } from "./tools.ts";

export type Config = {
  port: number;
  prompt: string;
  openai: { url: string; key: string; model: string; reasoningEffort: string; prices: Prices };
  sonarr: { url: string; key: string };
  radarr: { url: string; key: string };
  tmdb: { url: string; key: string };
  mdblist: { url: string; key: string };
  maxToolRounds: number;
  keepAliveMs: number;
  pollMs: number;
  commandTimeoutMs: number;
  retryDelaysMs: number[];
};

export async function configFromEnv(): Promise<Config> {
  const env = (name: string, fallback?: string) => {
    const value = process.env[name] ?? fallback;
    if (value === undefined) throw new Error(`Missing env var ${name}`);
    return value;
  };
  return {
    port: Number(env("PORT", "8080")),
    prompt: await Bun.file(env("PROMPT_FILE", `${import.meta.dir}/prompt.txt`)).text(),
    openai: {
      url: env("OPENAI_URL", "https://api.openai.com/v1"),
      key: env("OPENAI_API_KEY"),
      model: env("OPENAI_MODEL"),
      reasoningEffort: env("OPENAI_REASONING_EFFORT", "low"),
      // OpenAI's API reports tokens, not money, so prices for the chosen model are configured next to it.
      prices: {
        input: Number(env("OPENAI_PRICE_INPUT")),
        cachedInput: Number(env("OPENAI_PRICE_CACHED_INPUT")),
        output: Number(env("OPENAI_PRICE_OUTPUT")),
        webSearch: Number(env("OPENAI_PRICE_WEB_SEARCH")),
      },
    },
    sonarr: { url: env("SONARR_URL"), key: env("SONARR_API_KEY") },
    radarr: { url: env("RADARR_URL"), key: env("RADARR_API_KEY") },
    tmdb: { url: env("TMDB_URL", "https://api.themoviedb.org/3"), key: env("TMDB_API_KEY") },
    mdblist: { url: env("MDBLIST_URL", "https://api.mdblist.com"), key: env("MDBLIST_API_KEY") },
    maxToolRounds: Number(env("MAX_TOOL_ROUNDS", "8")),
    keepAliveMs: 5_000,
    pollMs: 2_000,
    commandTimeoutMs: 5 * 60_000,
    retryDelaysMs: [1_000, 3_000, 9_000],
  };
}

const encoder = new TextEncoder();

function chat(cfg: Config, body: { message?: unknown; previousResponseId?: unknown }): Response {
  if (typeof body.message !== "string" || !body.message.trim())
    return Response.json({ error: "message is required" }, { status: 400 });
  const message = body.message;
  const previousResponseId = typeof body.previousResponseId === "string" ? body.previousResponseId : undefined;

  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let lastSent = Date.now();
  let lastLabel = "Thinking…";
  const emit: Emit = (event, data) => {
    if (event === "progress") lastLabel = String(data.label);
    if (!controller) return;
    try {
      controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      lastSent = Date.now();
    } catch {
      controller = undefined;
    }
  };
  // Bun closes connections idle for 10 s, and tools like a Sonarr search can take minutes.
  const keepAlive = setInterval(() => {
    if (Date.now() - lastSent >= cfg.keepAliveMs) emit("progress", { label: lastLabel });
  }, cfg.keepAliveMs);

  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
        // Not awaited by the stream: a turn (and any grab in it) runs to completion even if the browser goes away.
        runTurn(
          cfg,
          toolDefinitions,
          (name, args, progress) => runTool(cfg, name, args, progress),
          message,
          previousResponseId,
          emit,
        )
          .catch((e) => {
            console.error(`turn failed: ${e instanceof Error ? e.message : e}`);
            emit("error", {
              message:
                e instanceof UserFacingError
                  ? e.message
                  : `Something went wrong: ${e instanceof Error ? e.message : e}`,
            });
          })
          .finally(() => {
            clearInterval(keepAlive);
            try {
              controller?.close();
            } catch {
              // The client already went away and the stream is closed.
            }
          });
      },
      cancel() {
        controller = undefined;
      },
    }),
    { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } },
  );
}

export function createServer(cfg: Config) {
  return Bun.serve({
    port: cfg.port,
    idleTimeout: 30,
    routes: {
      "/api/health": new Response("ok"),
      "/api/chat": {
        POST: async (req) => {
          // Any site the user visits could otherwise POST here as text/plain, which browsers send
          // cross-origin without asking. Requiring JSON forces a CORS preflight that foreign sites fail.
          if (!req.headers.get("content-type")?.startsWith("application/json"))
            return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
          const site = req.headers.get("sec-fetch-site");
          if (site && site !== "same-origin" && site !== "none")
            return Response.json({ error: "Cross-site requests are not allowed" }, { status: 403 });
          return chat(cfg, (await req.json().catch(() => ({}))) as Record<string, unknown>);
        },
      },
    },
    fetch: () => new Response("Not found", { status: 404 }),
  });
}

if (import.meta.main) {
  const cfg = await configFromEnv();
  const server = createServer(cfg);
  console.log(`dashboard-agent listening on :${server.port} with model ${cfg.openai.model}`);
}
