// Tests drive the backend through its HTTP interface only, with every upstream replaced by a fake server.
import { afterEach, expect, test } from "bun:test";
import { createServer, type Config } from "./server.ts";

// Fakes record whatever JSON they were sent, and tests reach into it freely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Call = { method: string; path: string; query: URLSearchParams; headers: Headers; body: any };
type Routes = Record<string, (call: Call) => unknown>;

const servers: { stop(force?: boolean): unknown }[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.stop(true);
});

function fake(routes: Routes) {
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
type OpenAIEvent = Record<string, unknown>;
function fakeOpenAI(script: (OpenAIEvent[] | number)[]) {
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

const reply = (id: string, ...chunks: string[]): OpenAIEvent[] => [
  { type: "response.created", response: { id, status: "in_progress", output: [] } },
  ...chunks.map((delta) => ({ type: "response.output_text.delta", delta })),
  { type: "response.completed", response: { id, status: "completed", output: [{ type: "message" }] } },
];

const toolCall = (id: string, name: string, args: unknown = {}): OpenAIEvent[] => {
  const item = { type: "function_call", id: `fc_${id}`, call_id: `call_${id}`, name, arguments: JSON.stringify(args) };
  return [
    { type: "response.created", response: { id, status: "in_progress", output: [] } },
    { type: "response.output_item.added", output_index: 0, item: { ...item, arguments: "" } },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: { id, status: "completed", output: [item] } },
  ];
};

function setup(
  upstreams: {
    openai: ReturnType<typeof fake>;
    sonarr?: Routes;
    radarr?: Routes;
    tmdb?: Routes;
    mdblist?: Routes;
    tmdbKey?: string;
  },
  overrides: Partial<Config> = {},
) {
  const sonarr = fake(upstreams.sonarr ?? {});
  const radarr = fake(upstreams.radarr ?? {});
  const tmdb = fake(upstreams.tmdb ?? {});
  const mdblist = fake(upstreams.mdblist ?? {});
  const server = createServer({
    port: 0,
    prompt: "test prompt",
    openai: { url: `${upstreams.openai.url}/v1`, key: "sk-test", model: "test-model", reasoningEffort: "low" },
    sonarr: { url: sonarr.url, key: "sonarr-key" },
    radarr: { url: radarr.url, key: "radarr-key" },
    tmdb: { url: tmdb.url, key: upstreams.tmdbKey ?? "tmdb-v3-key" },
    mdblist: { url: mdblist.url, key: "mdb-key" },
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
  return { chat, url: `http://localhost:${server.port}`, openai: upstreams.openai, sonarr, radarr, tmdb, mdblist };
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
const toolOutput = (openai: ReturnType<typeof fake>, request: number) =>
  JSON.parse(openai.called("POST", "/v1/responses")[request]!.body.input[0].output);

test("plain text streams through as text events, then done with the response id", async () => {
  const { chat, openai } = setup({ openai: fakeOpenAI([reply("resp_1", "Hello", " there")]) });

  const events = await chat({ message: "hi" });

  expect(events).toEqual([
    { event: "text", data: { delta: "Hello" } },
    { event: "text", data: { delta: " there" } },
    { event: "done", data: { responseId: "resp_1" } },
  ]);
  const request = openai.calls[0]!;
  expect(request.headers.get("authorization")).toBe("Bearer sk-test");
  expect(request.body).toMatchObject({
    model: "test-model",
    instructions: "test prompt",
    stream: true,
    input: [{ role: "user", content: "hi" }],
  });
  expect(request.body.tools).toContainEqual({ type: "web_search" });
  expect(request.body.previous_response_id).toBeUndefined();
});

test("cross-site requests are refused before reaching OpenAI", async () => {
  const { url, openai } = setup({ openai: fakeOpenAI([reply("resp_1", "should not run")]) });
  const post = (headers: Record<string, string>) =>
    fetch(`${url}/api/chat`, { method: "POST", headers, body: JSON.stringify({ message: "get heat" }) });

  // A form or no-cors fetch from another site can only send "simple" content types like text/plain.
  expect((await post({ "content-type": "text/plain" })).status).toBe(415);
  expect((await post({ "content-type": "application/json", "sec-fetch-site": "cross-site" })).status).toBe(403);
  expect((await post({ "content-type": "application/json", "sec-fetch-site": "same-origin" })).status).toBe(200);
  await Bun.sleep(50);
  expect(openai.calls).toHaveLength(1);
});

test("tool arguments that don't match the schema never reach Sonarr", async () => {
  const { chat, openai, sonarr } = setup({
    openai: fakeOpenAI([
      toolCall("resp_1", "set_monitored", { app: "sonarr", id: "../config/host", monitored: false }),
      reply("resp_2", "Refused."),
    ]),
    sonarr: { "GET /api/v3/config/host": () => ({ apiKey: "secret" }) },
  });

  await chat({ message: "unmonitor it" });

  expect(sonarr.calls).toHaveLength(0);
  expect(toolOutput(openai, 1)).toEqual({ error: "Invalid arguments for set_monitored: id" });
});

test("previousResponseId is forwarded to OpenAI", async () => {
  const { chat, openai } = setup({ openai: fakeOpenAI([reply("resp_2", "ok")]) });

  await chat({ message: "and another", previousResponseId: "resp_1" });

  expect(openai.calls[0]!.body.previous_response_id).toBe("resp_1");
});

test("a tool round: get_queue hits Sonarr and Radarr and the result goes back to OpenAI", async () => {
  const { chat, openai, sonarr, radarr } = setup({
    openai: fakeOpenAI([toolCall("resp_1", "get_queue"), reply("resp_2", "Two things are downloading.")]),
    sonarr: {
      "GET /api/v3/queue": () => ({
        records: [
          {
            title: "Show.S01E02.1080p",
            size: 1e9,
            sizeleft: 2.5e8,
            series: { title: "Severance" },
            episode: { seasonNumber: 1, episodeNumber: 2 },
            quality: { quality: { name: "WEBDL-1080p" } },
          },
        ],
      }),
    },
    radarr: {
      "GET /api/v3/queue": () => ({
        records: [{ title: "Heat.1995.1080p", size: 8e9, sizeleft: 8e9, movie: { title: "Heat", year: 1995 } }],
      }),
    },
  });

  const events = await chat({ message: "what's downloading?" });

  expect(events).toContainEqual({ event: "progress", data: { label: "Checking the download queue…" } });
  expect(events.at(-1)).toEqual({ event: "done", data: { responseId: "resp_2" } });
  expect(sonarr.calls[0]!.headers.get("x-api-key")).toBe("sonarr-key");
  expect(radarr.calls[0]!.headers.get("x-api-key")).toBe("radarr-key");
  const second = openai.calls[1]!.body;
  expect(second.previous_response_id).toBe("resp_1");
  expect(second.input[0]).toMatchObject({ type: "function_call_output", call_id: "call_resp_1" });
  expect(toolOutput(openai, 1)).toMatchObject([
    { app: "Sonarr", title: "Severance S01E02", progress: "75%", quality: "WEBDL-1080p" },
    { app: "Radarr", title: "Heat (1995)", progress: "0%" },
  ]);
});

test("TMDB v4 read tokens go in the Authorization header, v3 keys in the query", async () => {
  for (const tmdbKey of ["eyJhbGciOiJIUzI1NiJ9.token", "abc123"]) {
    const { chat, openai, tmdb } = setup({
      openai: fakeOpenAI([
        toolCall("resp_1", "search", { query: "heat", type: "movie" }),
        reply("resp_2", "Found it."),
      ]),
      tmdb: {
        "GET /search/movie": () => ({
          results: [{ id: 949, title: "Heat", release_date: "1995-12-15", poster_path: "/heat.jpg" }],
        }),
      },
      tmdbKey,
    });

    await chat({ message: "heat" });

    const call = tmdb.calls[0]!;
    expect(call.query.get("query")).toBe("heat");
    if (tmdbKey.startsWith("eyJ")) {
      expect(call.headers.get("authorization")).toBe(`Bearer ${tmdbKey}`);
      expect(call.query.has("api_key")).toBe(false);
    } else {
      expect(call.query.get("api_key")).toBe(tmdbKey);
      expect(call.headers.get("authorization")).toBeNull();
    }
    expect(toolOutput(openai, 1)).toEqual([
      { type: "movie", tmdbId: 949, title: "Heat", year: 1995, poster: "https://image.tmdb.org/t/p/w342/heat.jpg" },
    ]);
  }
});

const completedCommand = {
  "GET /api/v3/command/1": () => ({ id: 1, status: "completed" }),
  "POST /api/v3/command": () => ({ id: 1, status: "queued" }),
};

test("acquire for a show not in the library adds it with the default profile and root folder, then searches", async () => {
  let queue: unknown[] = [];
  let loaded = false;
  const { chat, openai, sonarr } = setup({
    openai: fakeOpenAI([
      toolCall("resp_1", "acquire", { type: "tv", tmdbId: 95396, season: 1 }),
      reply("resp_2", "Done."),
    ]),
    tmdb: { "GET /tv/95396/external_ids": () => ({ tvdb_id: 371980 }) },
    sonarr: {
      "GET /api/v3/series": (c) =>
        c.query.get("tvdbId")
          ? []
          : [
              { id: 1, qualityProfileId: 4, path: "/tv/A" },
              { id: 2, qualityProfileId: 4, path: "/tv/B" },
              { id: 3, qualityProfileId: 6, path: "/anime/C" },
            ],
      "GET /api/v3/series/lookup": () => [{ title: "Severance", tvdbId: 371980, seasons: [{ seasonNumber: 1 }] }],
      "GET /api/v3/qualityprofile": () => [
        { id: 4, name: "HD-1080p" },
        { id: 6, name: "Any" },
      ],
      "GET /api/v3/rootfolder": () => [{ path: "/anime" }, { path: "/tv" }],
      "POST /api/v3/series": () => ({ id: 9, title: "Severance" }),
      // Sonarr loads episodes in the background after an add.
      "GET /api/v3/series/9": () => {
        const series = {
          id: 9,
          title: "Severance",
          seasons: [{ seasonNumber: 1, statistics: { episodeCount: loaded ? 9 : 0, episodeFileCount: 0 } }],
          statistics: { totalEpisodeCount: loaded ? 9 : 0 },
        };
        loaded = true;
        return series;
      },
      "GET /api/v3/queue/details": () => queue,
      ...completedCommand,
      "POST /api/v3/command": () => {
        queue = [{ seasonNumber: 1, title: "Severance.S01.1080p" }];
        return { id: 1, status: "queued" };
      },
    },
  });

  await chat({ message: "get severance" });

  expect(sonarr.called("POST", "/api/v3/series")[0]!.body).toMatchObject({
    title: "Severance",
    tvdbId: 371980,
    qualityProfileId: 4,
    rootFolderPath: "/tv",
    monitored: true,
  });
  expect(sonarr.called("POST", "/api/v3/command")[0]!.body).toEqual({
    name: "SeasonSearch",
    seriesId: 9,
    seasonNumber: 1,
  });
  expect(sonarr.called("GET", "/api/v3/release")).toHaveLength(0);
  expect(toolOutput(openai, 1)).toMatchObject({ status: "grabbed_by_sonarr", added: true });
});

const heat = { id: 5, title: "Heat", year: 1995, tmdbId: 949, hasFile: false, monitored: true };

test("acquire, auto-grab path: Radarr's search puts it in the queue and no fallback runs", async () => {
  let queue: unknown[] = [];
  const { chat, openai, radarr } = setup({
    openai: fakeOpenAI([toolCall("resp_1", "acquire", { type: "movie", tmdbId: 949 }), reply("resp_2", "Grabbed.")]),
    radarr: {
      "GET /api/v3/movie": () => [heat],
      "GET /api/v3/queue/details": () => queue,
      "POST /api/v3/command": () => ({ id: 1, status: "queued" }),
      "GET /api/v3/command/1": () => {
        queue = [{ movieId: 5 }];
        return { id: 1, status: "completed" };
      },
    },
  });

  const events = await chat({ message: "get heat" });

  expect(radarr.called("POST", "/api/v3/command")[0]!.body).toEqual({ name: "MoviesSearch", movieIds: [5] });
  expect(radarr.called("POST", "/api/v3/movie")).toHaveLength(0);
  expect(radarr.called("GET", "/api/v3/release")).toHaveLength(0);
  expect(radarr.called("POST", "/api/v3/release")).toHaveLength(0);
  expect(toolOutput(openai, 1)).toMatchObject({ status: "grabbed_by_radarr", added: false });
  expect(events).toContainEqual({ event: "progress", data: { label: "Radarr searching…" } });
});

const release = (
  guid: string,
  resolution: number,
  name: string,
  qualityWeight: number,
  seeders: number,
  rejections: string[],
  size = 4.2 * 1024 ** 3,
) => ({
  guid,
  indexerId: 3,
  title: `Heat.1995.${guid}`,
  quality: { quality: { name, resolution } },
  qualityWeight,
  seeders,
  size,
  rejections,
  rejected: rejections.length > 0,
});
const lowSeeds = (n: number) => `Not enough seeders: ${n}. Minimum seeders: 10`;

function radarrWithReleases(releases: unknown[], movie: object = heat) {
  return {
    "GET /api/v3/movie": () => [movie],
    "GET /api/v3/queue/details": () => [],
    ...completedCommand,
    "GET /api/v3/release": () => releases,
    "POST /api/v3/release": (c: Call) => c.body,
  };
}

test("acquire, fallback path: grabs the best release that only fails the seeder minimum", async () => {
  const { chat, openai, radarr } = setup({
    openai: fakeOpenAI([
      toolCall("resp_1", "acquire", { type: "movie", tmdbId: 949 }),
      reply("resp_2", "Got a low-seeded one."),
    ]),
    radarr: radarrWithReleases([
      release("web6", 1080, "WEBDL-1080p", 10, 6, [lowSeeds(6)]),
      release("bluray4", 1080, "Bluray-1080p", 12, 4, [lowSeeds(4)]),
      release("bluray2", 1080, "Bluray-1080p", 12, 2, [lowSeeds(2)]),
      release("720p", 720, "HDTV-720p", 14, 9, [lowSeeds(9)]),
      release("huge", 1080, "Bluray-1080p", 12, 9, [lowSeeds(9), "45.3 GB is larger than maximum allowed 14.7 GB"]),
      release("wrong", 1080, "Bluray-1080p", 12, 9, [
        lowSeeds(9),
        "Unknown Movie. Unable to parse movie info from release name",
      ]),
      release("blocked", 1080, "Bluray-1080p", 12, 9, [lowSeeds(9), "Release is blocklisted"]),
      release("dead", 2160, "Bluray-2160p", 20, 0, [lowSeeds(0)]),
    ]),
  });

  await chat({ message: "get heat" });

  expect(radarr.called("POST", "/api/v3/release").map((c) => c.body)).toEqual([{ guid: "bluray4", indexerId: 3 }]);
  expect(toolOutput(openai, 1)).toMatchObject({
    status: "grabbed_fallback",
    release: "Heat.1995.bluray4",
    summary: "Bluray-1080p · 4.2 GB · 4 seeds",
    bentRule: lowSeeds(4),
  });
});

test("acquire, nothing qualifies: reports the closest candidates and grabs nothing", async () => {
  const { chat, openai, radarr } = setup({
    openai: fakeOpenAI([
      toolCall("resp_1", "acquire", { type: "movie", tmdbId: 949 }),
      reply("resp_2", "Nothing usable."),
    ]),
    radarr: radarrWithReleases([
      release("720p", 720, "HDTV-720p", 8, 9, [lowSeeds(9)]),
      release("huge", 1080, "Bluray-1080p", 12, 9, [lowSeeds(9), "45.3 GB is larger than maximum allowed 14.7 GB"]),
    ]),
  });

  await chat({ message: "get heat" });

  expect(radarr.called("POST", "/api/v3/release")).toHaveLength(0);
  const output = toolOutput(openai, 1);
  expect(output.status).toBe("nothing_qualified");
  expect(output.candidates).toEqual([
    {
      release: "Heat.1995.huge",
      summary: "Bluray-1080p · 4.2 GB · 9 seeds",
      rejectedBecause: [lowSeeds(9), "45.3 GB is larger than maximum allowed 14.7 GB"],
    },
    {
      release: "Heat.1995.720p",
      summary: "HDTV-720p · 4.2 GB · 9 seeds",
      rejectedBecause: [lowSeeds(9), "below 1080p"],
    },
  ]);
});

test("acquire with the movie already on disk or already queued grabs nothing", async () => {
  const grabbable = [release("bluray4", 1080, "Bluray-1080p", 12, 4, [lowSeeds(4)])];
  for (const [movie, queue, status] of [
    [{ ...heat, hasFile: true }, [], "already_have"],
    [heat, [{ movieId: 5 }], "already_downloading"],
  ] as const) {
    const { chat, openai, radarr } = setup({
      openai: fakeOpenAI([
        toolCall("resp_1", "acquire", { type: "movie", tmdbId: 949 }),
        reply("resp_2", "Already sorted."),
      ]),
      radarr: { ...radarrWithReleases(grabbable, movie), "GET /api/v3/queue/details": () => queue },
    });

    await chat({ message: "get heat" });

    expect(toolOutput(openai, 1).status).toBe(status);
    expect(radarr.called("POST", "/api/v3/command")).toHaveLength(0);
    expect(radarr.called("POST", "/api/v3/release")).toHaveLength(0);
  }
});

test("inspect_releases explains the rejections and the fallback's pick without grabbing anything", async () => {
  const { chat, openai, radarr } = setup({
    openai: fakeOpenAI([
      toolCall("resp_1", "inspect_releases", { type: "movie", tmdbId: 949 }),
      reply("resp_2", "Low seeds."),
    ]),
    radarr: radarrWithReleases([
      release("720p", 720, "HDTV-720p", 8, 9, [lowSeeds(9)]),
      release("bluray4", 1080, "Bluray-1080p", 12, 4, [lowSeeds(4)]),
    ]),
  });

  await chat({ message: "why didn't heat download?" });

  expect(radarr.called("POST", "/api/v3/release")).toHaveLength(0);
  expect(radarr.called("POST", "/api/v3/command")).toHaveLength(0);
  expect(toolOutput(openai, 1)).toEqual({
    total: 2,
    approved: 0,
    fallbackWouldGrab: { release: "Heat.1995.bluray4", summary: "Bluray-1080p · 4.2 GB · 4 seeds" },
    releases: [
      {
        release: "Heat.1995.bluray4",
        summary: "Bluray-1080p · 4.2 GB · 4 seeds",
        approved: false,
        rejections: [lowSeeds(4)],
        failsFallbackFloor: [],
      },
      {
        release: "Heat.1995.720p",
        summary: "HDTV-720p · 4.2 GB · 9 seeds",
        approved: false,
        rejections: [lowSeeds(9)],
        failsFallbackFloor: ["below 1080p"],
      },
    ],
  });
});

test("get_ratings returns MDBList scores with Rotten Tomatoes and Letterboxd links", async () => {
  const { chat, openai, mdblist } = setup({
    openai: fakeOpenAI([
      toolCall("resp_1", "get_ratings", { type: "movie", tmdbIds: [949] }),
      reply("resp_2", "Rated."),
    ]),
    mdblist: {
      "POST /tmdb/movie/": () => [
        {
          title: "Heat",
          year: 1995,
          ids: { imdb: "tt0113277", tmdb: 949 },
          ratings: [
            { source: "imdb", value: 8.3, url: "114" },
            { source: "tomatoes", value: 84, url: "/m/heat_1995" },
            { source: "popcorn", value: 94, url: "/m/heat_1995" },
            { source: "letterboxd", value: 8.6, url: "/film/heat-1995/" },
            { source: "myanimelist", value: null },
          ],
        },
      ],
    },
  });

  await chat({ message: "how is heat rated?" });

  const call = mdblist.calls[0]!;
  expect(call.query.get("apikey")).toBe("mdb-key");
  expect(call.body).toEqual({ ids: [949] });
  expect(toolOutput(openai, 1)).toEqual([
    {
      title: "Heat",
      year: 1995,
      tmdbId: 949,
      ratings: { imdb: 8.3, tomatoes: 84, popcorn: 94, letterboxd: 8.6 },
      links: {
        rottenTomatoes: "https://www.rottentomatoes.com/m/heat_1995",
        letterboxd: "https://letterboxd.com/film/heat-1995/",
      },
    },
  ]);
});

test("the turn completes and the grab happens even when the client disconnects mid-stream", async () => {
  let polls = 0;
  const { url, openai, radarr } = setup({
    openai: fakeOpenAI([toolCall("resp_1", "acquire", { type: "movie", tmdbId: 949 }), reply("resp_2", "Grabbed.")]),
    radarr: {
      ...radarrWithReleases([release("bluray4", 1080, "Bluray-1080p", 12, 4, [lowSeeds(4)])]),
      // The search runs for a while, long enough for the client to leave.
      "GET /api/v3/command/1": () => ({ id: 1, status: ++polls < 20 ? "started" : "completed" }),
    },
  });

  const abort = new AbortController();
  const res = await fetch(`${url}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "get heat" }),
    signal: abort.signal,
  });
  const reader = res.body!.getReader();
  await reader.read();
  abort.abort();

  const deadline = Date.now() + 2_000;
  while (openai.calls.length < 2 && Date.now() < deadline) await Bun.sleep(10);
  expect(radarr.called("POST", "/api/v3/release").map((c) => c.body)).toEqual([{ guid: "bluray4", indexerId: 3 }]);
  expect(openai.calls).toHaveLength(2);
});

test("keep-alive progress events are sent during a slow tool", async () => {
  const { chat } = setup(
    {
      openai: fakeOpenAI([toolCall("resp_1", "get_queue"), reply("resp_2", "Nothing.")]),
      sonarr: { "GET /api/v3/queue": async () => (await Bun.sleep(250), { records: [] }) },
      radarr: { "GET /api/v3/queue": () => ({ records: [] }) },
    },
    { keepAliveMs: 50 },
  );

  const events = await chat({ message: "what's downloading?" });

  const queueProgress = events.filter((e) => e.event === "progress" && e.data.label === "Checking the download queue…");
  expect(queueProgress.length).toBeGreaterThanOrEqual(3);
  expect(events.at(-1)).toEqual({ event: "done", data: { responseId: "resp_2" } });
});

test("the tool-round cap stops a looping model", async () => {
  const { chat, openai } = setup(
    {
      openai: fakeOpenAI([toolCall("resp_loop", "get_queue")]),
      sonarr: { "GET /api/v3/queue": () => ({ records: [] }) },
      radarr: { "GET /api/v3/queue": () => ({ records: [] }) },
    },
    { maxToolRounds: 2 },
  );

  const events = await chat({ message: "loop forever" });

  expect(openai.calls).toHaveLength(3);
  expect(events.at(-1)).toEqual({
    event: "error",
    data: { message: "Stopped after 2 tool rounds without a final answer." },
  });
  expect(events.some((e) => e.event === "done")).toBe(false);
});

test("OpenAI overload is retried, then surfaces as an error", async () => {
  const { chat, openai } = setup({ openai: fakeOpenAI([503, 503, 503]) });

  const events = await chat({ message: "hi" });

  expect(openai.calls).toHaveLength(3);
  expect(events).toEqual([
    { event: "error", data: { message: "OpenAI API error (HTTP 503): The server is overloaded" } },
  ]);
});

test("an overload that clears on retry still answers", async () => {
  const { chat, openai } = setup({ openai: fakeOpenAI([503, reply("resp_1", "Back.")]) });

  const events = await chat({ message: "hi" });

  expect(openai.calls).toHaveLength(2);
  expect(events.at(-1)).toEqual({ event: "done", data: { responseId: "resp_1" } });
});
