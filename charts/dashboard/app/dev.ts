// Serves the page from web/ and forwards /api to an agent, the way nginx and the Ingress do in the cluster.
// Files are read per request, so edits show on reload. Pair it with `bun run tunnel` (see the README).
const agent = process.env.AGENT_URL ?? "http://localhost:18090";
const port = Number(process.env.PORT ?? 18081);

Bun.serve({
  port,
  idleTimeout: 0,
  fetch: async (req) => {
    const { pathname } = new URL(req.url);
    if (!pathname.startsWith("/api/")) {
      const file = Bun.file(`${import.meta.dir}/web/${pathname === "/" ? "index.html" : pathname.slice(1)}`);
      return (await file.exists()) ? new Response(file) : new Response("Not found", { status: 404 });
    }
    const body = req.body ? await req.arrayBuffer() : undefined;
    // kubectl port-forward drops whenever a client resets a stream; the tunnel loop restarts it within a second.
    for (let attempt = 0; ; attempt++) {
      try {
        return await fetch(`${agent}${pathname}`, { method: req.method, headers: req.headers, body });
      } catch (e) {
        if ((e as { code?: string }).code !== "ECONNREFUSED" || attempt >= 10) throw e;
        await Bun.sleep(500);
      }
    }
  },
});
console.log(`Dashboard on http://localhost:${port}, /api → ${agent}`);
