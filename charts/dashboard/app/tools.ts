// The model's tools. Each one hard-codes its endpoints; there is no generic API pass-through.
import type { FunctionTool } from "./openai.ts";
import type { Config } from "./server.ts";
import { acquire, inspectReleases } from "./acquire.ts";
import type { components as Sonarr } from "./types/sonarr.ts";
import type { components as Radarr } from "./types/radarr.ts";

export type Series = Sonarr["schemas"]["SeriesResource"];
export type Movie = Radarr["schemas"]["MovieResource"];
type SonarrQueue = Sonarr["schemas"]["QueueResourcePagingResource"];
type RadarrQueue = Radarr["schemas"]["QueueResourcePagingResource"];
type QueueItem = NonNullable<SonarrQueue["records"] | RadarrQueue["records"]>[number];

// TMDB and MDBList publish no types we can generate from; these cover only the fields we read.
type TmdbTitle = {
  id: number;
  media_type?: string;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  overview?: string;
  poster_path?: string | null;
};
type TmdbDetails = TmdbTitle & {
  tagline?: string;
  genres?: { name: string }[];
  runtime?: number;
  episode_run_time?: number[];
  number_of_seasons?: number;
  status?: string;
  created_by?: { name: string }[];
  external_ids?: { imdb_id?: string | null };
  credits?: { cast?: { name: string }[]; crew?: { name: string; job: string }[] };
  videos?: { results?: { site: string; type: string; key: string }[] };
};
type TmdbReview = { author: string; author_details?: { rating?: number | null }; content: string };
type MdbListItem = {
  title?: string;
  year?: number;
  ids?: { tmdb?: number };
  tmdbid?: number;
  ratings?: { source: string; value: number | null; url?: string | null }[];
};

export type App = "sonarr" | "radarr";
export type MediaType = "movie" | "tv";

export async function arr<T = unknown>(
  cfg: Config,
  app: App,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const method = init?.method ?? "GET";
  const res = await fetch(`${cfg[app].url}/api/v3${path}`, {
    method,
    headers: { "x-api-key": cfg[app].key, "content-type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  }).catch((e) => {
    throw new Error(`${appName[app]} is unreachable: ${e.message}`);
  });
  if (!res.ok)
    throw new Error(
      `${appName[app]} returned HTTP ${res.status} for ${method} ${path}: ${(await res.text()).slice(0, 300)}`,
    );
  return res.status === 204 ? (undefined as T) : (res.json() as Promise<T>);
}

export const appName = { sonarr: "Sonarr", radarr: "Radarr" };

export async function tmdb<T>(cfg: Config, path: string, params: Record<string, string> = {}): Promise<T> {
  // A v4 read access token is a JWT and goes in a header; a v3 key goes in the query string.
  const v4 = cfg.tmdb.key.startsWith("eyJ");
  const query = new URLSearchParams(v4 ? params : { ...params, api_key: cfg.tmdb.key });
  const res = await fetch(`${cfg.tmdb.url}${path}?${query}`, {
    headers: v4 ? { authorization: `Bearer ${cfg.tmdb.key}` } : {},
  }).catch((e) => {
    throw new Error(`TMDB is unreachable: ${e.message}`);
  });
  if (!res.ok) throw new Error(`TMDB returned HTTP ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

const poster = (path?: string | null) => (path ? `https://image.tmdb.org/t/p/w342${path}` : undefined);
const year = (date?: string) => (date ? Number(date.slice(0, 4)) : undefined);

function summary(item: TmdbTitle, type?: MediaType) {
  const mediaType: MediaType = type ?? (item.media_type === "tv" ? "tv" : "movie");
  return {
    type: mediaType,
    tmdbId: item.id,
    title: item.title ?? item.name,
    year: year(item.release_date ?? item.first_air_date),
    tmdbRating: item.vote_average,
    overview: item.overview?.slice(0, 300),
    poster: poster(item.poster_path),
  };
}

async function libraryIds(cfg: Config) {
  const [movies, series] = await Promise.all([
    arr<Movie[]>(cfg, "radarr", "/movie"),
    arr<Series[]>(cfg, "sonarr", "/series"),
  ]);
  return { movie: new Set(movies.map((m) => m.tmdbId)), tv: new Set(series.map((s) => s.tmdbId)) };
}

async function getLibrary(cfg: Config) {
  const [movies, series] = await Promise.all([
    arr<Movie[]>(cfg, "radarr", "/movie"),
    arr<Series[]>(cfg, "sonarr", "/series"),
  ]);
  // One line per title keeps a big library small enough for the model to read whole.
  return [
    `Movies (${movies.length}): title (year) | genres | IMDb rating | file | monitored | ids`,
    ...movies.map((m) =>
      [
        `${m.title} (${m.year})`,
        m.genres?.join(", "),
        m.ratings?.imdb?.value ?? "-",
        m.hasFile ? "has file" : "missing",
        m.monitored ? "monitored" : "unmonitored",
        `tmdb:${m.tmdbId} radarr:${m.id}`,
      ].join(" | "),
    ),
    "",
    `Series (${series.length}): title (year) | genres | rating | episodes on disk | monitored | ids`,
    ...series.map((s) =>
      [
        `${s.title} (${s.year})`,
        s.genres?.join(", "),
        s.ratings?.value ?? "-",
        `${s.statistics?.episodeFileCount ?? 0}/${s.statistics?.episodeCount ?? 0} episodes`,
        s.monitored ? "monitored" : "unmonitored",
        `tmdb:${s.tmdbId} sonarr:${s.id}`,
      ].join(" | "),
    ),
  ].join("\n");
}

async function search(cfg: Config, { query, type }: { query: string; type?: MediaType }) {
  const data = await tmdb<{ results: TmdbTitle[] }>(cfg, type ? `/search/${type}` : "/search/multi", { query });
  return data.results
    .filter((r) => type || r.media_type !== "person")
    .slice(0, 10)
    .map((r) => summary(r, type));
}

async function discover(
  cfg: Config,
  { kind, type, tmdbId }: { kind: "recommendations" | "similar" | "trending"; type: MediaType; tmdbId?: number },
) {
  if (kind !== "trending" && !tmdbId) throw new Error(`${kind} needs a tmdbId`);
  const [data, owned] = await Promise.all([
    tmdb<{ results: TmdbTitle[] }>(cfg, kind === "trending" ? `/trending/${type}/week` : `/${type}/${tmdbId}/${kind}`),
    libraryIds(cfg),
  ]);
  return data.results.slice(0, 15).map((r) => ({ ...summary(r, type), inLibrary: owned[type].has(r.id) }));
}

async function getDetails(cfg: Config, { type, tmdbId }: { type: MediaType; tmdbId: number }) {
  const [d, owned] = await Promise.all([
    tmdb<TmdbDetails>(cfg, `/${type}/${tmdbId}`, { append_to_response: "videos,external_ids,credits" }),
    type === "movie"
      ? arr<Movie[]>(cfg, "radarr", `/movie?tmdbId=${tmdbId}`).then(
          (m) => m[0] && { radarrId: m[0].id, hasFile: m[0].hasFile, monitored: m[0].monitored },
        )
      : arr<Series[]>(cfg, "sonarr", "/series")
          .then((all) => all.find((s) => s.tmdbId === tmdbId))
          .then(
            (s) =>
              s && {
                sonarrId: s.id,
                monitored: s.monitored,
                episodesOnDisk: `${s.statistics?.episodeFileCount ?? 0}/${s.statistics?.episodeCount ?? 0}`,
                seasons: s.seasons?.map((x) => ({
                  season: x.seasonNumber,
                  monitored: x.monitored,
                  episodesOnDisk: `${x.statistics?.episodeFileCount ?? 0}/${x.statistics?.episodeCount ?? 0}`,
                })),
              },
          ),
  ]);
  const imdbId = d.external_ids?.imdb_id;
  return {
    ...summary(d, type),
    overview: d.overview,
    tagline: d.tagline || undefined,
    genres: d.genres?.map((g) => g.name),
    runtime: d.runtime ?? d.episode_run_time?.[0],
    seasons: d.number_of_seasons,
    status: d.status,
    directors: d.credits?.crew?.filter((c) => c.job === "Director").map((c) => c.name),
    creators: d.created_by?.map((c) => c.name),
    cast: d.credits?.cast?.slice(0, 6).map((c) => c.name),
    trailers: d.videos?.results
      ?.filter((v) => v.site === "YouTube" && v.type === "Trailer")
      .slice(0, 2)
      .map((v) => `https://www.youtube.com/watch?v=${v.key}`),
    imdbId,
    imdbUrl: imdbId ? `https://www.imdb.com/title/${imdbId}/` : undefined,
    tmdbUrl: `https://www.themoviedb.org/${type}/${tmdbId}`,
    library: owned ?? "not in library",
  };
}

async function getReviews(cfg: Config, { type, tmdbId }: { type: MediaType; tmdbId: number }) {
  const data = await tmdb<{ results: TmdbReview[] }>(cfg, `/${type}/${tmdbId}/reviews`);
  return data.results
    .slice(0, 5)
    .map((r) => ({ author: r.author, rating: r.author_details?.rating, content: r.content.slice(0, 1500) }));
}

// MDBList gives each rating the site's own path (e.g. "/m/heat_1995"), not a full URL.
const siteUrl = (item: MdbListItem, source: string, base: string) => {
  const path = item.ratings?.find((r) => r.source === source)?.url;
  return path ? `${base}${path}` : undefined;
};

async function getRatings(cfg: Config, { type, tmdbIds }: { type: MediaType; tmdbIds: number[] }) {
  const res = await fetch(
    `${cfg.mdblist.url}/tmdb/${type === "tv" ? "show" : "movie"}/?apikey=${encodeURIComponent(cfg.mdblist.key)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: tmdbIds }),
    },
  ).catch((e) => {
    throw new Error(`MDBList is unreachable: ${e.message}`);
  });
  if (!res.ok) throw new Error(`MDBList returned HTTP ${res.status}`);
  const data = (await res.json()) as MdbListItem[];
  return data.map((item) => ({
    title: item.title,
    year: item.year,
    tmdbId: item.ids?.tmdb ?? item.tmdbid,
    ratings: Object.fromEntries((item.ratings ?? []).filter((r) => r.value != null).map((r) => [r.source, r.value])),
    links: {
      rottenTomatoes: siteUrl(item, "tomatoes", "https://www.rottentomatoes.com"),
      letterboxd: siteUrl(item, "letterboxd", "https://letterboxd.com"),
    },
  }));
}

async function getQueue(cfg: Config) {
  const [sonarr, radarr] = await Promise.all([
    arr<SonarrQueue>(cfg, "sonarr", "/queue?pageSize=100&includeSeries=true&includeEpisode=true"),
    arr<RadarrQueue>(cfg, "radarr", "/queue?pageSize=100&includeMovie=true"),
  ]);
  const item = (app: App, title: string, q: QueueItem) => ({
    app: appName[app],
    title,
    release: q.title,
    quality: q.quality?.quality?.name,
    progress: q.size ? `${Math.round((1 - (q.sizeleft ?? 0) / q.size) * 100)}%` : undefined,
    size: gb(q.size),
    timeLeft: q.timeleft,
    status: q.trackedDownloadState ?? q.status,
    problem: q.errorMessage || q.statusMessages?.flatMap((m) => m.messages ?? []).join("; ") || undefined,
  });
  const episode = (n?: number | null) => String(n ?? "?").padStart(2, "0");
  return [
    ...(sonarr.records ?? []).map((q) =>
      item(
        "sonarr",
        `${q.series?.title ?? "?"} S${episode(q.episode?.seasonNumber ?? q.seasonNumber)}E${episode(q.episode?.episodeNumber)}`,
        q,
      ),
    ),
    ...(radarr.records ?? []).map((q) => item("radarr", `${q.movie?.title ?? "?"} (${q.movie?.year ?? "?"})`, q)),
  ];
}

export const gb = (bytes?: number) => (bytes ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : undefined);

async function setMonitored(
  cfg: Config,
  { app, id, season, monitored }: { app: App; id: number; season?: number; monitored: boolean },
) {
  if (app === "radarr") {
    await arr(cfg, "radarr", "/movie/editor", { method: "PUT", body: { movieIds: [id], monitored } });
    return { ok: true };
  }
  const series = await arr<Series>(cfg, "sonarr", `/series/${id}`);
  if (season === undefined) series.monitored = monitored;
  else {
    const s = series.seasons?.find((x) => x.seasonNumber === season);
    if (!s) throw new Error(`Season ${season} not found`);
    s.monitored = monitored;
  }
  await arr(cfg, "sonarr", `/series/${id}`, { method: "PUT", body: series });
  return { ok: true };
}

const type = { type: "string", enum: ["movie", "tv"] };
const tmdbId = { type: "integer", description: "TMDB id" };
const fn = (
  name: string,
  description: string,
  properties: Record<string, unknown> = {},
  required: string[] = Object.keys(properties),
): FunctionTool => ({
  type: "function",
  name,
  description,
  parameters: { type: "object", properties, required, additionalProperties: false },
});

export const toolDefinitions: FunctionTool[] = [
  fn(
    "get_library",
    "The user's whole library: every Radarr movie and Sonarr series, one per line, with genres, rating, whether files are on disk, monitoring, and ids.",
  ),
  fn(
    "search",
    "Search TMDB by title. Omit type to search movies and TV together.",
    { query: { type: "string" }, type },
    ["query"],
  ),
  fn(
    "discover",
    "TMDB recommendations or similar titles for a title, or this week's trending titles. Each result says whether it is already in the library.",
    { kind: { type: "string", enum: ["recommendations", "similar", "trending"] }, type, tmdbId },
    ["kind", "type"],
  ),
  fn(
    "get_details",
    "TMDB details for one title: overview, genres, runtime, director/creators, cast, poster, YouTube trailers, IMDb and TMDB links, and its library status.",
    { type, tmdbId },
  ),
  fn("get_reviews", "Up to 5 TMDB user reviews for a title.", { type, tmdbId }),
  fn(
    "get_ratings",
    "Ratings from MDBList for one or more titles of the same type: imdb (0-10), tomatoes (critics %), popcorn (audience %), metacritic (0-100), letterboxd (0-10, divide by 2 for stars), tmdb (0-100) and more, plus Rotten Tomatoes and Letterboxd links.",
    { type, tmdbIds: { type: "array", items: { type: "integer" } } },
  ),
  fn(
    "acquire",
    "Get a title the user asked for: adds it to Radarr/Sonarr if missing, lets them search, and if they can't grab a release, grabs the best one that only fails the minimum-seeders rule. For TV, season targets one season; without it the whole show is searched and the fallback covers the first incomplete season. Only call when the user clearly asked to download.",
    { type, tmdbId, season: { type: "integer" } },
    ["type", "tmdbId"],
  ),
  fn(
    "inspect_releases",
    "Read-only look at what the indexers offer for a title already in Radarr/Sonarr: each release with quality, size, seeders and Sonarr/Radarr's rejection reasons, plus what the low-seeder fallback would grab. Use it to explain why something wasn't downloaded. Nothing is grabbed. For TV it covers one season (default: the first incomplete one).",
    { type, tmdbId, season: { type: "integer" } },
    ["type", "tmdbId"],
  ),
  fn(
    "set_monitored",
    "Turn monitoring on or off for a Radarr movie, a Sonarr series, or one season of a series. id is the radarr:/sonarr: id from the library.",
    {
      app: { type: "string", enum: ["radarr", "sonarr"] },
      id: { type: "integer" },
      season: { type: "integer" },
      monitored: { type: "boolean" },
    },
    ["app", "id", "monitored"],
  ),
  fn("get_queue", "What Sonarr and Radarr are downloading right now, with progress."),
];

type Args = Record<string, unknown>;

const labels: Record<string, (args: Args) => string> = {
  get_library: () => "Reading your library…",
  search: (a) => `Searching TMDB for “${a.query}”…`,
  discover: (a) => `Finding ${a.kind} titles…`,
  get_details: () => "Looking up details…",
  get_reviews: () => "Reading reviews…",
  get_ratings: () => "Fetching ratings…",
  acquire: () => "Getting it…",
  inspect_releases: () => "Looking at the releases…",
  set_monitored: (a) => `${a.monitored ? "Monitoring" : "Unmonitoring"} in ${appName[a.app as App]}…`,
  get_queue: () => "Checking the download queue…",
};

// Arguments come from the model and are shaped by each tool's JSON schema above.
const handlers: Record<string, (cfg: Config, args: never, progress: (label: string) => void) => Promise<unknown>> = {
  get_library: getLibrary,
  search,
  discover,
  get_details: getDetails,
  get_reviews: getReviews,
  get_ratings: getRatings,
  acquire,
  inspect_releases: inspectReleases,
  set_monitored: setMonitored,
  get_queue: getQueue,
};

export async function runTool(
  cfg: Config,
  name: string,
  args: Args,
  progress: (label: string) => void,
): Promise<unknown> {
  const handler = handlers[name];
  if (!handler) throw new Error(`Unknown tool ${name}`);
  progress(labels[name]!(args));
  return handler(cfg, args as never, progress);
}
