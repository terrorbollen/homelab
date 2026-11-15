// MDBList: ratings from IMDb, Rotten Tomatoes, Metacritic, Letterboxd and more in one call.
import type { Config } from "./server.ts";
import type { MediaType } from "./tmdb.ts";

// MDBList publishes no types we can generate from; this covers only the fields we read.
type MdbListItem = {
  title?: string;
  year?: number;
  ids?: { tmdb?: number };
  tmdbid?: number;
  ratings?: { source: string; value: number | null; votes?: number | null; url?: string | null }[];
};

// MDBList gives each rating the site's own path (e.g. "/m/heat_1995"), not a full URL.
const siteUrl = (item: MdbListItem, source: string, base: string) => {
  const path = item.ratings?.find((r) => r.source === source)?.url;
  return path ? `${base}${path}` : undefined;
};

export async function getRatings(cfg: Config, { type, tmdbIds }: { type: MediaType; tmdbIds: number[] }) {
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
    ratings: Object.fromEntries(
      (item.ratings ?? [])
        .filter((r) => r.value != null)
        .map((r) => [r.source, { score: r.value, ...(r.votes != null && { votes: r.votes }) }]),
    ),
    links: {
      rottenTomatoes: siteUrl(item, "tomatoes", "https://www.rottentomatoes.com"),
      letterboxd: siteUrl(item, "letterboxd", "https://letterboxd.com"),
    },
  }));
}
