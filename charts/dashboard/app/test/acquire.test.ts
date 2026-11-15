// Getting titles: adding, Sonarr/Radarr's own search, the low-seeder fallback, and inspecting releases.
import { afterEach, expect, test } from "bun:test";
import { fakeOpenAI, reply, setup, stopFakes, toolCall, toolOutput, type Call } from "./fakes.ts";

afterEach(stopFakes);

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
