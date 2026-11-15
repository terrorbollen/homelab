// The read-only tools and the argument check every tool call goes through.
import { afterEach, expect, test } from "bun:test";
import { fakeOpenAI, reply, setup, stopFakes, toolCall, toolOutput } from "./fakes.ts";

afterEach(stopFakes);

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

test("get_ratings returns MDBList scores with vote counts and Rotten Tomatoes and Letterboxd links", async () => {
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
            { source: "imdb", value: 8.3, votes: 824525, url: "114" },
            { source: "tomatoes", value: 84, votes: 157, url: "/m/heat_1995" },
            { source: "popcorn", value: 94, votes: 100000, url: "/m/heat_1995" },
            { source: "letterboxd", value: 8.6, votes: null, url: "/film/heat-1995/" },
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
      ratings: {
        imdb: { score: 8.3, votes: 824525 },
        tomatoes: { score: 84, votes: 157 },
        popcorn: { score: 94, votes: 100000 },
        letterboxd: { score: 8.6 },
      },
      links: {
        rottenTomatoes: "https://www.rottentomatoes.com/m/heat_1995",
        letterboxd: "https://letterboxd.com/film/heat-1995/",
      },
    },
  ]);
});

test("get_torrents does Transmission's session handshake and reports every torrent, unfinished first", async () => {
  const { chat, openai, transmission } = setup({
    openai: fakeOpenAI([toolCall("resp_1", "get_torrents"), reply("resp_2", "One is stalled.")]),
    transmission: {
      "POST /transmission/rpc": (c) => {
        // Like the real server, refuse requests without the current session id.
        if (c.headers.get("x-transmission-session-id") !== "sess-1")
          return new Response("", { status: 409, headers: { "x-transmission-session-id": "sess-1" } });
        if (c.body.method === "session_stats")
          return { jsonrpc: "2.0", id: c.body.id, result: { download_speed: 3 * 1024 ** 2, upload_speed: 512 * 1024 } };
        const torrent = {
          rate_upload: 0,
          peers_connected: 0,
          peers_sending_to_us: 0,
          error: 0,
          error_string: "",
          labels: [],
        };
        return {
          jsonrpc: "2.0",
          id: c.body.id,
          result: {
            torrents: [
              {
                ...torrent,
                name: "Heat.1995.1080p",
                status: 6,
                percent_done: 1,
                size_when_done: 8 * 1024 ** 3,
                rate_download: 0,
                eta: -1,
                upload_ratio: 1.5,
                labels: ["radarr"],
              },
              {
                ...torrent,
                name: "Manual.Add.Linux.iso",
                status: 4,
                percent_done: 0.25,
                size_when_done: 4 * 1024 ** 3,
                rate_download: 3 * 1024 ** 2,
                eta: 4500,
                peers_connected: 12,
                peers_sending_to_us: 3,
                upload_ratio: -1,
                error: 2,
                error_string: "Tracker gave HTTP 404",
              },
            ],
          },
        };
      },
    },
  });

  await chat({ message: "why is it slow?" });

  const calls = transmission.called("POST", "/transmission/rpc");
  expect(calls.every((c) => c.body.jsonrpc === "2.0")).toBe(true);
  expect(calls.find((c) => c.body.method === "torrent_get")!.body.params.fields).toContain("peers_sending_to_us");
  expect(toolOutput(openai, 1)).toEqual({
    downloadSpeed: "3.0 MB/s",
    uploadSpeed: "0.5 MB/s",
    total: 2,
    torrents: [
      {
        name: "Manual.Add.Linux.iso",
        status: "downloading",
        progress: "25%",
        size: "4.0 GB",
        down: "3.0 MB/s",
        eta: "1h 15m",
        peers: "3 of 12 connected are sending",
        error: "Tracker gave HTTP 404",
      },
      {
        name: "Heat.1995.1080p",
        category: "radarr",
        status: "seeding",
        progress: "100%",
        size: "8.0 GB",
        peers: "0 of 0 connected are sending",
        ratio: "1.50",
      },
    ],
  });
});

test("get_torrents always lists failing torrents, even when healthy ones fill the cap", async () => {
  const torrent = (name: string, error = 0) => ({
    name,
    status: 6,
    percent_done: 1,
    size_when_done: 1024 ** 3,
    rate_download: 0,
    rate_upload: 0,
    eta: -1,
    peers_connected: 0,
    peers_sending_to_us: 0,
    upload_ratio: 1,
    error,
    error_string: error ? "Please Verify Local Data! Piece #55 is corrupt." : "",
    labels: [],
  });
  const healthy = Array.from({ length: 60 }, (_, i) => torrent(`Healthy.${i}`));
  const { chat, openai } = setup({
    openai: fakeOpenAI([toolCall("resp_1", "get_torrents"), reply("resp_2", "One is corrupt.")]),
    transmission: {
      "POST /transmission/rpc": (c) => ({
        jsonrpc: "2.0",
        id: c.body.id,
        result:
          c.body.method === "session_stats"
            ? { download_speed: 0, upload_speed: 0 }
            : { torrents: [...healthy, torrent("Corrupt.One", 3)] },
      }),
    },
  });

  await chat({ message: "any broken torrents?" });

  const output = toolOutput(openai, 1);
  expect(output.total).toBe(61);
  expect(output.torrents).toHaveLength(50);
  expect(output.torrents[0]).toMatchObject({
    name: "Corrupt.One",
    error: "Please Verify Local Data! Piece #55 is corrupt.",
  });
  expect(output.healthyNotListed).toBe(11);
});
