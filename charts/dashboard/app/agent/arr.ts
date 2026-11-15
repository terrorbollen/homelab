// Sonarr and Radarr: the library, the download queue and monitoring.
import type { Config } from "./server.ts";
import { gb } from "./format.ts";
import type { components as Sonarr } from "../types/sonarr.ts";
import type { components as Radarr } from "../types/radarr.ts";

export type Series = Sonarr["schemas"]["SeriesResource"];
export type Movie = Radarr["schemas"]["MovieResource"];
type SonarrQueue = Sonarr["schemas"]["QueueResourcePagingResource"];
type RadarrQueue = Radarr["schemas"]["QueueResourcePagingResource"];
type QueueItem = NonNullable<SonarrQueue["records"] | RadarrQueue["records"]>[number];

export type App = "sonarr" | "radarr";
export const appName = { sonarr: "Sonarr", radarr: "Radarr" };

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

export async function libraryIds(cfg: Config) {
  const [movies, series] = await Promise.all([
    arr<Movie[]>(cfg, "radarr", "/movie"),
    arr<Series[]>(cfg, "sonarr", "/series"),
  ]);
  return { movie: new Set(movies.map((m) => m.tmdbId)), tv: new Set(series.map((s) => s.tmdbId)) };
}

export async function getLibrary(cfg: Config) {
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

export async function getQueue(cfg: Config) {
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

export async function setMonitored(
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
