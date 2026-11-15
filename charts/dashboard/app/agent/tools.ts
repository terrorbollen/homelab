// The model's tools. Each one hard-codes its endpoints; there is no generic API pass-through.
// A tool's schema, progress label and handler live together, so adding one touches one place.
import type { FunctionTool } from "./openai.ts";
import type { Config } from "./server.ts";
import { acquire, inspectReleases } from "./acquire.ts";
import { appName, getLibrary, getQueue, setMonitored, type App } from "./arr.ts";
import { getRatings } from "./mdblist.ts";
import { discover, getDetails, getReviews, search } from "./tmdb.ts";
import { getTorrents } from "./transmission.ts";

type Args = Record<string, unknown>;
type Progress = (label: string) => void;
type Tool = {
  definition: FunctionTool;
  label: (args: Args) => string;
  // Arguments come from the model; runTool checks them against the definition's schema first.
  run: (cfg: Config, args: never, progress: Progress) => Promise<unknown>;
};

const tool = ({
  name,
  description,
  properties = {},
  required = Object.keys(properties),
  label,
  run,
}: {
  name: string;
  description: string;
  properties?: Record<string, unknown>;
  required?: string[];
  label: Tool["label"];
  run: Tool["run"];
}): Tool => ({
  definition: {
    type: "function",
    name,
    description,
    parameters: { type: "object", properties, required, additionalProperties: false },
  },
  label,
  run,
});

const type = { type: "string", enum: ["movie", "tv"] };
const tmdbId = { type: "integer", description: "TMDB id" };

const tools: Tool[] = [
  tool({
    name: "get_library",
    description:
      "The user's whole library: every Radarr movie and Sonarr series, one per line, with genres, rating, whether files are on disk, monitoring, and ids.",
    label: () => "Reading your library…",
    run: getLibrary,
  }),
  tool({
    name: "search",
    description: "Search TMDB by title. Omit type to search movies and TV together.",
    properties: { query: { type: "string" }, type },
    required: ["query"],
    label: (a) => `Searching TMDB for “${a.query}”…`,
    run: search,
  }),
  tool({
    name: "discover",
    description:
      "TMDB recommendations or similar titles for a title, or this week's trending titles. Each result says whether it is already in the library.",
    properties: { kind: { type: "string", enum: ["recommendations", "similar", "trending"] }, type, tmdbId },
    required: ["kind", "type"],
    label: (a) => `Finding ${a.kind} titles…`,
    run: discover,
  }),
  tool({
    name: "get_details",
    description:
      "TMDB details for one title: overview, genres, runtime, director/creators, cast, poster, YouTube trailers, IMDb and TMDB links, and its library status.",
    properties: { type, tmdbId },
    label: () => "Looking up details…",
    run: getDetails,
  }),
  tool({
    name: "get_reviews",
    description: "Up to 5 TMDB user reviews for a title.",
    properties: { type, tmdbId },
    label: () => "Reading reviews…",
    run: getReviews,
  }),
  tool({
    name: "get_ratings",
    description:
      "Ratings from MDBList for one or more titles of the same type: imdb (0-10), tomatoes (critics %), popcorn (audience %), metacritic (0-100), letterboxd (0-10, divide by 2 for stars), tmdb (0-100) and more, each with its vote count (for tomatoes, the number of critic reviews; for popcorn, audience ratings), plus Rotten Tomatoes and Letterboxd links.",
    properties: { type, tmdbIds: { type: "array", items: { type: "integer" } } },
    label: () => "Fetching ratings…",
    run: getRatings,
  }),
  tool({
    name: "acquire",
    description:
      "Get a title the user asked for: adds it to Radarr/Sonarr if missing, lets them search, and if they can't grab a release, grabs the best one that only fails the minimum-seeders rule. For TV, season targets one season; without it the whole show is searched and the fallback covers the first incomplete season. Only call when the user clearly asked to download.",
    properties: { type, tmdbId, season: { type: "integer" } },
    required: ["type", "tmdbId"],
    label: () => "Getting it…",
    run: acquire,
  }),
  tool({
    name: "inspect_releases",
    description:
      "Read-only look at what the indexers offer for a title already in Radarr/Sonarr: each release with quality, size, seeders and Sonarr/Radarr's rejection reasons, plus what the low-seeder fallback would grab. Use it to explain why something wasn't downloaded. Nothing is grabbed. For TV it covers one season (default: the first incomplete one).",
    properties: { type, tmdbId, season: { type: "integer" } },
    required: ["type", "tmdbId"],
    label: () => "Looking at the releases…",
    run: inspectReleases,
  }),
  tool({
    name: "set_monitored",
    description:
      "Turn monitoring on or off for a Radarr movie, a Sonarr series, or one season of a series. id is the radarr:/sonarr: id from the library.",
    properties: {
      app: { type: "string", enum: ["radarr", "sonarr"] },
      id: { type: "integer" },
      season: { type: "integer" },
      monitored: { type: "boolean" },
    },
    required: ["app", "id", "monitored"],
    label: (a) => `${a.monitored ? "Monitoring" : "Unmonitoring"} in ${appName[a.app as App]}…`,
    run: setMonitored,
  }),
  tool({
    name: "get_queue",
    description: "What Sonarr and Radarr are downloading right now, with progress.",
    label: () => "Checking the download queue…",
    run: getQueue,
  }),
  tool({
    name: "get_torrents",
    description:
      "Everything in Transmission, the download client: each torrent's state, progress, speed, peers, ETA, seed ratio and errors, including torrents added outside Sonarr/Radarr, plus total speeds. Use it with get_queue to explain slow or stuck downloads.",
    label: () => "Checking Transmission…",
    run: getTorrents,
  }),
];

export const toolDefinitions = tools.map((t) => t.definition);

type Schema = { type: string; enum?: unknown[]; items?: Schema };
const valid = (s: Schema, v: unknown): boolean =>
  (s.type === "integer"
    ? Number.isInteger(v)
    : s.type === "array"
      ? Array.isArray(v) && v.every((x) => valid(s.items!, x))
      : typeof v === s.type) &&
  (!s.enum || s.enum.includes(v));

// The model can be steered by text it reads (web pages, reviews), and arguments end up in
// Sonarr/Radarr URL paths, so hold every call to its schema: an id like "../config/host" never gets through.
function checkArgs(tool: FunctionTool, raw: Args): Args {
  const { properties, required } = tool.parameters as { properties: Record<string, Schema>; required: string[] };
  const args = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null));
  const bad = [
    ...required.filter((k) => !(k in args)),
    ...Object.entries(args)
      .filter(([k, v]) => !properties[k] || !valid(properties[k], v))
      .map(([k]) => k),
  ];
  if (bad.length) throw new Error(`Invalid arguments for ${tool.name}: ${bad.join(", ")}`);
  return args;
}

export async function runTool(cfg: Config, name: string, raw: Args, progress: Progress): Promise<unknown> {
  const tool = tools.find((t) => t.definition.name === name);
  if (!tool) throw new Error(`Unknown tool ${name}`);
  const args = checkArgs(tool.definition, raw);
  progress(tool.label(args));
  return tool.run(cfg, args as never, progress);
}
