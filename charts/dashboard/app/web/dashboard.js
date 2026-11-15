// The start page: service grid, filter, Cmd+K palette and clock.
const lan = (host, path = "/") => `http://${host}.192.168.0.36.nip.io${path}`;
const icon = (name) => `https://cdn.jsdelivr.net/gh/selfhst/icons/svg/${name}.svg`;

const groups = [
  {
    name: "Arr stack",
    accent: "from-sky-400 to-cyan-300",
    services: [
      {
        name: "Seerr",
        desc: "Request movies & shows",
        url: lan("seerr"),
        icon: icon("overseerr"),
      },
      {
        name: "Sonarr",
        desc: "TV series",
        url: lan("media", "/sonarr/"),
        icon: icon("sonarr"),
      },
      {
        name: "Radarr",
        desc: "Movies",
        url: lan("media", "/radarr/"),
        icon: icon("radarr"),
      },
      {
        name: "Prowlarr",
        desc: "Indexers",
        url: lan("media", "/prowlarr/"),
        icon: icon("prowlarr"),
      },
      {
        name: "Bazarr",
        desc: "Subtitles",
        url: lan("media", "/bazarr/"),
        icon: icon("bazarr"),
      },
      {
        name: "Transmission",
        desc: "Downloads over VPN",
        url: lan("media", "/transmission/"),
        icon: icon("transmission"),
      },
    ],
  },
  {
    name: "Media & apps",
    accent: "from-fuchsia-400 to-pink-300",
    services: [
      {
        name: "Emby",
        desc: "Streaming",
        url: lan("media"),
        icon: icon("emby"),
      },
      {
        name: "Immich",
        desc: "Photos",
        url: lan("immich"),
        icon: icon("immich"),
      },
      {
        name: "Obsidian LiveSync",
        desc: "CouchDB admin",
        url: lan("obsidian-livesync", "/_utils/"),
        icon: icon("obsidian"),
      },
      {
        name: "Portfolio",
        desc: "friis-jespersen.dev",
        url: "https://friis-jespersen.dev",
        icon: icon("homepage"),
      },
    ],
  },
  {
    name: "Infrastructure",
    accent: "from-amber-300 to-orange-400",
    services: [
      {
        name: "Argo CD",
        desc: "GitOps",
        url: lan("argocd"),
        icon: icon("argo-cd"),
      },
      {
        name: "Grafana",
        desc: "Metrics & logs",
        url: lan("grafana"),
        icon: icon("grafana"),
      },
      {
        name: "Traefik",
        desc: "Ingress",
        url: lan("traefik", "/dashboard/"),
        icon: icon("traefik"),
      },
    ],
  },
];

const root = document.getElementById("groups");
for (const group of groups) {
  const section = document.createElement("section");
  section.innerHTML = `
  <h2 class="mb-4 flex items-center gap-3 text-sm font-semibold uppercase tracking-widest text-slate-400">
    <span class="h-2 w-2 rounded-full bg-gradient-to-r ${group.accent}"></span>${group.name}
    <span class="h-px flex-1 bg-white/10"></span>
  </h2>
  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"></div>`;
  const grid = section.querySelector("div");
  for (const s of group.services) {
    const a = document.createElement("a");
    a.href = s.url;
    a.dataset.search = `${s.name} ${s.desc} ${group.name}`.toLowerCase();
    a.className =
      "group relative flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur transition hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.08] focus:outline-none focus:ring-2 focus:ring-sky-400/60";
    a.innerHTML = `
    <div class="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/5 ring-1 ring-white/10">
      <img src="${s.icon}" alt="" class="h-8 w-8" onerror="this.replaceWith('${s.name[0]}')">
    </div>
    <div class="min-w-0 flex-1">
      <div class="font-medium">${s.name}</div>
      <div class="truncate text-sm text-slate-400">${s.desc}</div>
    </div>
    <span class="status h-2 w-2 rounded-full bg-slate-600" title="Checking…"></span>`;
    grid.append(a);
    // no-cors yields an opaque response: it can't show HTTP status, only that the host answered.
    const dot = a.querySelector(".status");
    fetch(s.url, { mode: "no-cors", signal: AbortSignal.timeout(5000) })
      .then(() => {
        dot.className = "status h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400";
        dot.title = "Reachable";
      })
      .catch(() => {
        dot.className = "status h-2 w-2 rounded-full bg-rose-500";
        dot.title = "Unreachable";
      });
  }
  root.append(section);
}

const search = document.getElementById("search");
const visible = () => [...root.querySelectorAll("a")].filter((a) => !a.hidden);
search.addEventListener("input", () => {
  const q = search.value.trim().toLowerCase();
  for (const a of root.querySelectorAll("a")) a.hidden = !a.dataset.search.includes(q);
  for (const section of root.children) section.hidden = !section.querySelector("a:not([hidden])");
});
search.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && visible()[0]) location.href = visible()[0].href;
});
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    e.preventDefault();
    search.focus();
  }
  if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    openPalette();
  }
});

// fzf-style: the query's letters must appear in order; runs of consecutive
// letters and matches at word starts score higher. Returns null on no match.
const fuzzy = (query, text) => {
  const t = text.toLowerCase();
  const hits = [];
  let score = 0,
    from = 0;
  for (const ch of query.toLowerCase()) {
    const i = t.indexOf(ch, from);
    if (i < 0) return null;
    score += 1 + (i === from && hits.length ? 3 : 0) + (i === 0 || t[i - 1] === " " ? 2 : 0);
    hits.push(i);
    from = i + 1;
  }
  return { score: score - (hits[0] ?? 0) * 0.1, hits };
};

const services = groups.flatMap((g) => g.services.map((s) => ({ ...s, group: g.name })));
const palette = document.getElementById("palette");
const paletteInput = document.getElementById("palette-input");
const paletteResults = document.getElementById("palette-results");
let results = [],
  selected = 0;

const renderPalette = () => {
  results = services
    .map((s) => ({
      s,
      m: fuzzy(paletteInput.value, `${s.name} ${s.desc} ${s.group}`),
    }))
    .filter((r) => r.m)
    .sort((a, b) => b.m.score - a.m.score);
  selected = Math.min(selected, Math.max(results.length - 1, 0));
  paletteResults.innerHTML = results.length
    ? ""
    : `<li class="px-3 py-6 text-center text-sm text-slate-500">No matches</li>`;
  results.forEach(({ s, m }, i) => {
    const name = [...s.name]
      .map((c, j) => (m.hits.includes(j) ? `<span class="text-sky-400">${c}</span>` : c))
      .join("");
    const li = document.createElement("li");
    li.className = `flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 ${i === selected ? "bg-white/10" : ""}`;
    li.innerHTML = `
    <img src="${s.icon}" alt="" class="h-6 w-6">
    <span class="flex-1 font-medium">${name}</span>
    <span class="text-xs text-slate-500">${s.group}</span>`;
    li.addEventListener("click", () => (location.href = s.url));
    li.addEventListener("mousemove", () => {
      if (selected !== i) {
        selected = i;
        renderPalette();
      }
    });
    paletteResults.append(li);
  });
  paletteResults.children[selected]?.scrollIntoView({ block: "nearest" });
};

const openPalette = () => {
  paletteInput.value = "";
  selected = 0;
  renderPalette();
  palette.showModal();
};

paletteInput.addEventListener("input", () => {
  selected = 0;
  renderPalette();
});
paletteInput.addEventListener("keydown", (e) => {
  if ((e.key === "ArrowDown" || e.key === "ArrowUp") && results.length) {
    e.preventDefault();
    selected = (selected + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
    renderPalette();
  }
  if (e.key === "Enter" && results[selected]) location.href = results[selected].s.url;
});
palette.addEventListener("click", (e) => {
  if (e.target === palette) palette.close();
});

const tick = () => {
  const now = new Date();
  const h = now.getHours();
  document.getElementById("greeting").textContent =
    h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  document.getElementById("clock").textContent = now.toLocaleString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
};
tick();
setInterval(tick, 10000);
