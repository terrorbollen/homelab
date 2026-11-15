// Transmission, the download client: what Sonarr/Radarr's queues don't show.
import type { Config } from "./server.ts";
import { duration, gb, speed } from "./format.ts";

// Transmission 4.1+ speaks JSON-RPC 2.0 with snake_case names; the older protocol is deprecated.
type Torrent = {
  name: string;
  status: number;
  percent_done: number;
  size_when_done: number;
  rate_download: number;
  rate_upload: number;
  eta: number;
  peers_connected: number;
  peers_sending_to_us: number;
  upload_ratio: number;
  error: number;
  error_string: string;
  labels: string[];
};
const TORRENT_STATUS = [
  "stopped",
  "queued to verify",
  "verifying",
  "queued",
  "downloading",
  "queued to seed",
  "seeding",
];

let transmissionSession = "";
async function transmission<T>(cfg: Config, method: string, params: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(cfg.transmission.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-transmission-session-id": transmissionSession },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    }).catch((e) => {
      throw new Error(`Transmission is unreachable: ${e.message}`);
    });
    // Transmission's CSRF guard: a 409 hands out the session id to resend the request with.
    if (res.status === 409) {
      transmissionSession = res.headers.get("x-transmission-session-id") ?? "";
      continue;
    }
    if (!res.ok) throw new Error(`Transmission returned HTTP ${res.status} for ${method}`);
    const body = (await res.json()) as { result?: T; error?: { message: string; data?: { error_string?: string } } };
    if (body.error) throw new Error(`Transmission: ${body.error.data?.error_string ?? body.error.message}`);
    return body.result!;
  }
  throw new Error("Transmission kept rejecting the session id");
}

export async function getTorrents(cfg: Config) {
  const [{ torrents }, stats] = await Promise.all([
    transmission<{ torrents: Torrent[] }>(cfg, "torrent_get", {
      fields: [
        "name",
        "status",
        "percent_done",
        "size_when_done",
        "rate_download",
        "rate_upload",
        "eta",
        "peers_connected",
        "peers_sending_to_us",
        "upload_ratio",
        "error",
        "error_string",
        "labels",
      ],
    }),
    transmission<{ download_speed: number; upload_speed: number }>(cfg, "session_stats", {}),
  ]);
  // Unfinished or failing torrents are what questions are about, so they are always listed in full;
  // healthy finished ones fill the remaining room.
  const needsAttention = (t: Torrent) => t.percent_done < 1 || t.error !== 0;
  const problems = torrents.filter(needsAttention).sort((a, b) => a.percent_done - b.percent_done);
  const healthy = torrents.filter((t) => !needsAttention(t));
  const listed = [...problems, ...healthy.slice(0, Math.max(0, 50 - problems.length))];
  return {
    downloadSpeed: speed(stats.download_speed),
    uploadSpeed: speed(stats.upload_speed),
    total: torrents.length,
    ...(listed.length < torrents.length && { healthyNotListed: torrents.length - listed.length }),
    torrents: listed.map((t) => ({
      name: t.name,
      category: t.labels.join(", ") || undefined,
      status: TORRENT_STATUS[t.status] ?? `status ${t.status}`,
      progress: `${Math.round(t.percent_done * 100)}%`,
      size: gb(t.size_when_done),
      down: t.rate_download ? speed(t.rate_download) : undefined,
      up: t.rate_upload ? speed(t.rate_upload) : undefined,
      // Negative values are libtransmission's "unknown" markers.
      eta: t.eta >= 0 ? duration(t.eta) : undefined,
      peers: `${t.peers_sending_to_us} of ${t.peers_connected} connected are sending`,
      ratio: t.upload_ratio >= 0 ? t.upload_ratio.toFixed(2) : undefined,
      error: t.error ? t.error_string : undefined,
    })),
  };
}
