// TMDB: search, discovery, details and reviews.
import type { Config } from "./server.ts";
import { arr, libraryIds, type Movie, type Series } from "./arr.ts";

export type MediaType = "movie" | "tv";

// TMDB publishes no types we can generate from; these cover only the fields we read.
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

export async function search(cfg: Config, { query, type }: { query: string; type?: MediaType }) {
  const data = await tmdb<{ results: TmdbTitle[] }>(cfg, type ? `/search/${type}` : "/search/multi", { query });
  return data.results
    .filter((r) => type || r.media_type !== "person")
    .slice(0, 10)
    .map((r) => summary(r, type));
}

export async function discover(
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

export async function getDetails(cfg: Config, { type, tmdbId }: { type: MediaType; tmdbId: number }) {
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

export async function getReviews(cfg: Config, { type, tmdbId }: { type: MediaType; tmdbId: number }) {
  const data = await tmdb<{ results: TmdbReview[] }>(cfg, `/${type}/${tmdbId}/reviews`);
  return data.results
    .slice(0, 5)
    .map((r) => ({ author: r.author, rating: r.author_details?.rating, content: r.content.slice(0, 1500) }));
}
