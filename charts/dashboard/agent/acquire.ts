// The get-it flow is deterministic code, not model judgment: add, let Sonarr/Radarr search,
// and only if they grab nothing, take the best release whose sole rejection is the seeder minimum.
import type { Config } from "./server.ts";
import { arr, appName, gb, tmdb, type App, type MediaType, type Movie, type Series } from "./tools.ts";
import type { components as Sonarr } from "./types/sonarr.ts";

type Release = Sonarr["schemas"]["ReleaseResource"];
type Progress = (label: string) => void;

// Sonarr and Radarr word this rejection the same way (TorrentSeedingSpecification).
const SEEDERS = /^Not enough seeders/;

async function waitFor<T>(cfg: Config, check: () => Promise<T | undefined>): Promise<T | undefined> {
  const deadline = Date.now() + cfg.commandTimeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result !== undefined) return result;
    await Bun.sleep(cfg.pollMs);
  }
}

async function runCommand(cfg: Config, app: App, body: Record<string, unknown>) {
  const command = await arr(cfg, app, "/command", { method: "POST", body });
  const done = await waitFor(cfg, async () => {
    const c = await arr(cfg, app, `/command/${command.id}`);
    return ["completed", "failed", "aborted", "cancelled", "orphaned"].includes(c.status) ? c : undefined;
  });
  if (!done) throw new Error(`${appName[app]} search didn't finish within ${cfg.commandTimeoutMs / 60_000} minutes`);
  if (done.status !== "completed") throw new Error(`${appName[app]} search ${done.status}: ${done.message ?? ""}`);
}

// New titles get the profile and root folder most of the library already uses.
async function defaults(
  cfg: Config,
  app: App,
  library: { qualityProfileId?: number; path?: string | null }[],
  preferredProfile?: string,
) {
  const [profiles, roots] = await Promise.all([
    arr<{ id: number; name: string }[]>(cfg, app, "/qualityprofile"),
    arr<{ path: string }[]>(cfg, app, "/rootfolder"),
  ]);
  const mostCommon = <T>(values: T[]) => {
    const counts = new Map<T, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  const qualityProfileId =
    profiles.find((p) => p.name === preferredProfile)?.id ??
    mostCommon(library.map((i) => i.qualityProfileId)) ??
    profiles[0]?.id;
  const rootFolderPath =
    mostCommon(library.map((i) => roots.find((r) => i.path?.startsWith(r.path))?.path).filter(Boolean)) ??
    roots[0]?.path;
  if (!qualityProfileId || !rootFolderPath) throw new Error(`${appName[app]} has no quality profile or root folder`);
  return { qualityProfileId, rootFolderPath };
}

const describe = (r: Release) => [r.quality?.quality?.name, gb(r.size), `${r.seeders ?? 0} seeds`].join(" · ");

async function fallback(cfg: Config, app: App, query: string, progress: Progress, matches: (r: Release) => boolean) {
  progress(`Asking ${appName[app]}'s indexers for releases…`);
  const releases = await arr<Release[]>(cfg, app, `/release?${query}`);
  progress(`Checking ${releases.length} releases…`);

  // Size, title match and blocklist are Sonarr/Radarr rules: a release that breaks one carries that rejection.
  // These are the only extra rules, a hard floor for what the fallback may grab.
  const floor = (r: Release) => [
    ...((r.seeders ?? 0) < 1 ? ["no seeders"] : []),
    ...((r.quality?.quality?.resolution ?? 0) < 1080 ? ["below 1080p"] : []),
    ...(matches(r) ? [] : ["not a full season pack"]),
  ];
  const qualifies = (r: Release) =>
    !!r.rejections?.length && r.rejections.every((x) => SEEDERS.test(x)) && !floor(r).length;
  const rank = (a: Release, b: Release) =>
    (b.qualityWeight ?? 0) - (a.qualityWeight ?? 0) || (b.seeders ?? 0) - (a.seeders ?? 0);
  const [best] = releases.filter(qualifies).sort(rank);

  if (!best) {
    const candidates = releases
      .sort(rank)
      .slice(0, 5)
      .map((r) => ({
        release: r.title,
        summary: describe(r),
        rejectedBecause: [...(r.rejections ?? []), ...floor(r)],
      }));
    return {
      status: "nothing_qualified",
      message: `${appName[app]} grabbed nothing, and no release qualifies for the low-seeder fallback.`,
      candidates,
    };
  }

  progress(`Grabbing ${best.title}…`);
  await arr(cfg, app, "/release", { method: "POST", body: { guid: best.guid, indexerId: best.indexerId } });
  return {
    status: "grabbed_fallback",
    release: best.title,
    summary: describe(best),
    bentRule: best.rejections!.find((x) => SEEDERS.test(x)),
  };
}

async function acquireMovie(cfg: Config, tmdbId: number, progress: Progress) {
  let [movie] = await arr<Movie[]>(cfg, "radarr", `/movie?tmdbId=${tmdbId}`);
  let added = false;
  if (!movie) {
    progress("Adding to Radarr…");
    const [lookup, library] = await Promise.all([
      arr<Movie>(cfg, "radarr", `/movie/lookup/tmdb?tmdbId=${tmdbId}`),
      arr<Movie[]>(cfg, "radarr", "/movie"),
    ]);
    movie = await arr<Movie>(cfg, "radarr", "/movie", {
      method: "POST",
      body: {
        ...lookup,
        ...(await defaults(cfg, "radarr", library, "HD-1080p")),
        monitored: true,
        addOptions: { searchForMovie: false },
      },
    });
    added = true;
  }
  const title = `${movie.title} (${movie.year})`;
  if (movie.hasFile) return { status: "already_have", title };
  const queued = () =>
    arr<unknown[]>(cfg, "radarr", `/queue/details?movieId=${movie!.id}`).then((q) => (q.length ? q : undefined));
  if (await queued()) return { status: "already_downloading", title };

  progress("Radarr searching…");
  await runCommand(cfg, "radarr", { name: "MoviesSearch", movieIds: [movie.id] });
  if (await queued()) return { status: "grabbed_by_radarr", title, added };

  return { title, added, ...(await fallback(cfg, "radarr", `movieId=${movie.id}`, progress, () => true)) };
}

async function acquireSeries(cfg: Config, tmdbId: number, season: number | undefined, progress: Progress) {
  const { tvdb_id } = await tmdb(cfg, `/tv/${tmdbId}/external_ids`);
  if (!tvdb_id) throw new Error("TMDB has no TVDB id for this show, so Sonarr can't add it");
  let [series] = await arr<Series[]>(cfg, "sonarr", `/series?tvdbId=${tvdb_id}`);
  let added = false;
  if (!series) {
    progress("Adding to Sonarr…");
    const [[lookup], library] = await Promise.all([
      arr<Series[]>(cfg, "sonarr", `/series/lookup?term=tvdb:${tvdb_id}`),
      arr<Series[]>(cfg, "sonarr", "/series"),
    ]);
    if (!lookup) throw new Error(`Sonarr found no show with TVDB id ${tvdb_id}`);
    const created = await arr<Series>(cfg, "sonarr", "/series", {
      method: "POST",
      body: {
        ...lookup,
        ...(await defaults(cfg, "sonarr", library)),
        monitored: true,
        seasonFolder: true,
        addOptions: { monitor: "all", searchForMissingEpisodes: false },
      },
    });
    added = true;
    // Sonarr fetches the episode list in the background after an add; searching before that finds nothing.
    progress("Waiting for Sonarr to load episodes…");
    series = await waitFor(cfg, () =>
      arr<Series>(cfg, "sonarr", `/series/${created.id}`).then((s) =>
        s.statistics?.totalEpisodeCount ? s : undefined,
      ),
    );
    if (!series) throw new Error("Sonarr didn't load the episode list in time");
  }

  const incomplete = (s: { statistics?: { episodeCount?: number; episodeFileCount?: number } }) =>
    (s.statistics?.episodeFileCount ?? 0) < (s.statistics?.episodeCount ?? 0);
  const target =
    season ??
    series.seasons
      ?.filter((s) => s.seasonNumber! > 0)
      .sort((a, b) => a.seasonNumber! - b.seasonNumber!)
      .find(incomplete)?.seasonNumber;
  const title = `${series.title}${season === undefined ? "" : ` season ${season}`}`;
  if (target === undefined) return { status: "already_have", title, detail: "every aired episode is on disk" };
  const targetSeason = series.seasons?.find((s) => s.seasonNumber === target);
  if (!targetSeason) throw new Error(`${series.title} has no season ${target}`);
  if (!incomplete(targetSeason)) return { status: "already_have", title };

  const queued = () =>
    arr<{ seasonNumber?: number; episode?: { seasonNumber?: number } }[]>(
      cfg,
      "sonarr",
      `/queue/details?seriesId=${series!.id}&includeEpisode=true`,
    )
      .then((q) => q.filter((i) => season === undefined || (i.seasonNumber ?? i.episode?.seasonNumber) === target))
      .then((q) => (q.length ? q : undefined));
  if (await queued()) return { status: "already_downloading", title };

  progress("Sonarr searching…");
  await runCommand(
    cfg,
    "sonarr",
    season === undefined
      ? { name: "SeriesSearch", seriesId: series.id }
      : { name: "SeasonSearch", seriesId: series.id, seasonNumber: target },
  );
  if (await queued()) return { status: "grabbed_by_sonarr", title, added };

  // At most one grab per call, so the fallback only looks for a full pack of one season.
  return {
    title,
    added,
    season: target,
    ...(await fallback(
      cfg,
      "sonarr",
      `seriesId=${series.id}&seasonNumber=${target}`,
      progress,
      (r) => !!r.fullSeason && r.seasonNumber === target,
    )),
  };
}

export function acquire(
  cfg: Config,
  { type, tmdbId, season }: { type: MediaType; tmdbId: number; season?: number },
  progress: Progress,
) {
  return type === "movie" ? acquireMovie(cfg, tmdbId, progress) : acquireSeries(cfg, tmdbId, season, progress);
}
