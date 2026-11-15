# Dashboard

The homelab start page at `dashboard.192.168.0.36.nip.io`: a grid of services, a filter, a ⌘K palette, and a media
chat (⌘J) that knows the Sonarr/Radarr library, recommends with ratings and reviews, and can get titles.

## How it runs

Two Deployments, no image build. Both mount their code from a ConfigMap that globs a folder of `app/`:

| Part    | Folder       | Runs in                         | Serves              |
| ------- | ------------ | ------------------------------- | ------------------- |
| `web`   | `app/web/`   | nginx (`dashboard`)             | `/` — page and JS   |
| `agent` | `app/agent/` | Bun, stock image (`dashboard-agent`) | `/api` — the chat |

ConfigMap keys can't hold a `/`, so both folders stay flat; any file added to them is deployed. Generated types,
tests and tooling sit next to them and are never deployed (`.helmignore`).

The agent has no runtime dependencies. API keys come from the `dashboard-agent-keys` SealedSecret and never reach the
browser. The model, its reasoning effort and its prices are in `values.yaml`; change the prices with the model.

## The agent

- **Conversation state lives at OpenAI.** Each turn sends only the new message plus `previous_response_id`; the server
  keeps nothing. The browser keeps the rendered chat and the last response id in `localStorage`.
- **A turn always finishes**, even if the browser leaves, so a download is never cut off halfway.
- **One module per upstream** (`arr.ts`, `tmdb.ts`, `mdblist.ts`, `transmission.ts`); `tools.ts` is the registry,
  where each tool's schema, progress label and handler are defined together.
- **Getting a title is deterministic code** (`acquire.ts`), not model judgment: add it with the library's usual
  quality profile and root folder, let Sonarr/Radarr search, and only if they grab nothing take the best release whose
  sole rejection is the seeder minimum, at 1080p or better with at least one seeder. At most one grab per call.
  `inspect_releases` shows the same verdicts without grabbing.
- **Untrusted input is contained.** Web pages and reviews can steer the model, so every tool call is checked against
  its schema before it runs, rendered images load only from TMDB, and the chat only accepts same-origin JSON requests.

### `POST /api/chat`

Body `{ message, previousResponseId? }`, `Content-Type: application/json`. The response is a server-sent event stream:

| Event      | Data                                                              |
| ---------- | ----------------------------------------------------------------- |
| `text`     | `{ delta }`: a piece of the reply                                 |
| `progress` | `{ label }`: a step started; repeated as a keep-alive             |
| `usage`    | `{ cost }`: estimated USD for one OpenAI request in this turn     |
| `done`     | `{ responseId }`: send it as `previousResponseId` next turn       |
| `error`    | `{ message }`: shown to the user                                  |

## Working on it

Everything runs from `app/`, with Bun pinned in `.tool-versions`, which mise reads.

```sh
bun install
bun run test      # end-to-end against fake upstreams: no real Sonarr, Radarr or OpenAI calls
bun run check     # tsc
bun run lint
bun run format
bun run gen:types # refresh the Sonarr/Radarr API types
bun run verify    # format check, lint, type-check and tests: run before every commit
```

There is no CI for this chart. Renovate's Bun bumps (image and `.tool-versions` together) never automerge, so run
`bun run verify` on their branch before merging.

### Trying a change against the real library before merging

1. Deploy only the branch's agent (the page and Ingress stay as they are; Argo takes these resources over on merge):

   ```sh
   helm template dashboard .. -n dashboard \
     --show-only templates/agent-configmap.yaml --show-only templates/agent-deployment.yaml \
     --show-only templates/agent-service.yaml --show-only templates/agent-sealedsecret.yaml \
     | kubectl apply -n dashboard -f -
   ```

2. `bun run tunnel` in one terminal: a port-forward to the agent that restarts itself, because kubectl drops it
   whenever a browser cancels a stream, and it stays on the old pod after a rollout.
3. `bun run dev` in another, then open <http://localhost:18081>. It serves `web/` from disk and forwards `/api`.

Only ask the live agent read-only things unless you mean it: it talks to the real Sonarr, Radarr and Transmission.
