# cnvs-whiteboard-skills

Agent Skills + MCP server discovery for [**cnvs.app**](https://cnvs.app) — the free, no-signup real-time collaborative whiteboard. Any AI agent can read, write, draw, diagram, and subscribe to live human edits on a shared canvas, either through the hosted MCP server or the REST fallback.

Works with Claude Code, Claude Desktop, Cursor, OpenCode / OpenAI Codex, Aider (with MCP plugin), any other MCP-speaking client, and Hermes-family agents.

## MCP Server

**Endpoint**: `https://cnvs.app/mcp` (Streamable HTTP, protocol `2025-06-18`, no auth — the board ID is the access key).

**Registered in the official [MCP Registry](https://registry.modelcontextprotocol.io)** as [`app.cnvs/whiteboard`](https://registry.modelcontextprotocol.io/v0/servers?search=cnvs).

### Capabilities

- **Tools** (25): board creation and inspection; visual previews; text, link, image, and stroke editing; movement and deletion; live-update waits; and complete kanban column, lane, task, query, and export workflows. The exact production list is published in [`/.well-known/mcp.json`](https://cnvs.app/.well-known/mcp.json). State-changing operations also have REST mirrors under `https://cnvs.app/api/boards/<id>/…` for runtimes that cannot speak MCP.
- **Resources** (3): `cnvs://board/{id}/state.json` (full snapshot), `cnvs://board/{id}/preview.svg` (visual render), and `cnvs://board/{id}/tasks.json` (kanban state). All three are subscribable.
- **Subscriptions**: `resources/subscribe` supported with `notifications/resources/updated` pushed over SSE, debounced ~3 s after activity settles.
- **Live machine-readable manifests**: [`/quotas.json`](https://cnvs.app/quotas.json), [`/openapi.json`](https://cnvs.app/openapi.json), [`/llms.txt`](https://cnvs.app/llms.txt), [`/.well-known/mcp.json`](https://cnvs.app/.well-known/mcp.json), [`/.well-known/mcp/server.json`](https://cnvs.app/.well-known/mcp/server.json).

## Installation

### Codex / ChatGPT and Cursor packages

This repository is the public source package for both marketplace integrations:

- [`.codex-plugin/plugin.json`](./.codex-plugin/plugin.json) and [`.mcp.json`](./.mcp.json) describe the Codex / ChatGPT plugin.
- [`.cursor-plugin/plugin.json`](./.cursor-plugin/plugin.json) and [`mcp.json`](./mcp.json) describe the Cursor plugin.
- [`SUBMISSION.md`](./SUBMISSION.md) and [`CURSOR-MARKETPLACE.md`](./CURSOR-MARKETPLACE.md) contain the prepared listing copy, disclosures, reviewer flows, and submission checklists.

Both packages connect only to the hosted production endpoint; there is no local server process or secret to configure.

### Claude Desktop / Cursor / any MCP client

One-line config — add this to your client's `mcpServers` object:

```json
{
  "mcpServers": {
    "cnvs": {
      "type": "http",
      "url": "https://cnvs.app/mcp"
    }
  }
}
```

### Claude Code CLI

```bash
claude mcp add --transport http cnvs https://cnvs.app/mcp
```

### REST-only (no MCP client)

```bash
# Create a board
curl -X POST https://cnvs.app/api/boards

# Add text
curl -X POST https://cnvs.app/api/boards/<id>/texts \
  -H 'Content-Type: application/json' \
  -d '{"x":100,"y":200,"content":"# Hello","author":"ai:myagent"}'

# Long-poll for live changes
curl "https://cnvs.app/api/boards/<id>/wait?timeout_ms=25000"
```

Full REST reference: [`/llms.txt`](https://cnvs.app/llms.txt), [`/openapi.json`](https://cnvs.app/openapi.json).

## Access model

There is no account or OAuth flow. A board URL or board ID is a bearer-style access credential: anyone who knows an unlocked board URL can open it. Boards can optionally require an 8-character lowercase alphanumeric access key for writes or for both reads and writes; legacy 6-character keys remain accepted. Pass a key only through the MCP tool's `access_key` argument or the `X-Board-Key` HTTP header.

Do not paste private board URLs or access keys into public issues, logs, or repositories.

## Useful prompts

- Create a fresh whiteboard for our brainstorming session and return its URL.
- Open this cnvs.app board, inspect its preview, and summarize the layout.
- Turn this list into a shared kanban board with priorities and owners.

## Skills included

Two related Agent Skills live in this repo, published under the [agentskills.io](https://agentskills.io/specification) open standard so they work in any compatible runtime. Install them into `~/.claude/skills/` to teach the agent how to use the MCP server well (preview-before-JSON, REST-over-MCP for writes, author-tag conventions, subscription-then-react loop).

### [`cnvs-whiteboard/`](./cnvs-whiteboard/SKILL.md) — PRIMARY

Teaches an AI agent how to collaborate on a cnvs.app board in real time:

- Read the shared canvas state
- Draw / diagram / flowchart / annotate — add, update, move, and delete text, links, sticky notes, strokes, images, and Mermaid diagrams (flowcharts, sequence / class / ER diagrams, mind maps, gantt charts, concept maps)
- Render the SVG preview when the board contains drawings
- Subscribe to live human edits via MCP, react via REST

Activates on any cnvs.app board reference (URL `https://cnvs.app/#<id>`, `cnvs://board/<id>/...`, or a bare board ID) or phrases like "collaborate on / draw / diagram / annotate / watch a shared whiteboard or canvas."

### [`mcp-listen/`](./mcp-listen/SKILL.md) — HELPER (v0.3.0)

Push-to-model pump for Streamable-HTTP MCP servers with `capabilities.resources.subscribe: true`. Opens a session, subscribes to the resource URIs the caller hands over, and emits one JSON line per `notifications/resources/updated` event on stdout — designed to be wrapped by Claude Code's `Monitor` tool so every server push becomes an in-chat notification (no polling, no log tailing).

**Helper-only activation since v0.3.** Triggers only when the caller — a user or another skill — has supplied **both** an MCP server URL and at least one resource URI. Does NOT auto-activate from generic phrasing like "watch this file" or "stay in the loop". `cnvs-whiteboard` is the canonical caller and delegates its push channel here.

**Output split since v0.3.** Only the actionable `resource_updated` event reaches stdout by default. Connection / subscription / heartbeat / transient-error events go to stderr so a wrapping `Monitor` doesn't fire on the listener's own bookkeeping. Pass `--verbose` (or `-v`) to merge everything onto stdout for debugging or single-channel logging (legacy v0.2 behavior).

**Registry status.** Intentionally *not* listed in centralised skill registries yet. Current registry pipelines (e.g. `majiayu000/claude-skill-registry-core` as of 2026-05-03) archive only `SKILL.md` + generated metadata; they do not mirror bundled `scripts/**` or `package.json`, so an entry for `mcp-listen` would publish a broken skill. It will be (re-)submitted once core registries support directory-style skill archival with bundled-file mirroring and security scanning — see PR [`majiayu000/claude-skill-registry-core#40`](https://github.com/majiayu000/claude-skill-registry-core/pull/40) for the directory-archive primitive that just landed and the open question on bundled-script scanning. Until then, install it via `curl` from `cnvs.app` (below) or `git clone` this repo.

### Install the skills

```bash
# cnvs-whiteboard (SKILL.md only — no deps)
mkdir -p ~/.claude/skills/cnvs-whiteboard && cd ~/.claude/skills/cnvs-whiteboard
curl -O https://cnvs.app/cnvs-whiteboard/SKILL.md

# mcp-listen (SKILL.md + scripts/ + npm install)
mkdir -p ~/.claude/skills/mcp-listen && cd ~/.claude/skills/mcp-listen
curl -O https://cnvs.app/mcp-listen/SKILL.md \
     -O https://cnvs.app/mcp-listen/package.json \
     --create-dirs -o scripts/listen.mjs https://cnvs.app/mcp-listen/scripts/listen.mjs
npm install
```

Alternatively `git clone` this repo and `cp -r .claude/skills/* ~/.claude/skills/` — the `.claude/skills/` directory contains symlinks into `cnvs-whiteboard/` and `mcp-listen/` for Claude Code's expected layout.

## Spec compliance

Both skills follow the [agentskills.io spec](https://agentskills.io/specification):

- `name` matches the containing directory name
- `description` under 1024 characters, imperative phrasing, explicit trigger keywords
- `scripts/` subdirectory for bundled code (mcp-listen)
- `license: MIT`, `compatibility` field declared, cross-references in each skill's "Related skills" section to prevent activation overlap

## Why two skills

Earlier versions had a single page (`/skill-cnvs.md` on cnvs.app — now a legacy redirect). Splitting into two coherent units follows the spec's "design coherent units" best practice:

- `cnvs-whiteboard` owns the cnvs.app-specific workflow (read / write / render / gotchas).
- `mcp-listen` owns the generic push-to-model pattern (usable against any MCP server).

Cross-references keep them pairing cleanly: `cnvs-whiteboard` mentions `mcp-listen` as its delegated push channel; `mcp-listen` mentions `cnvs-whiteboard` as the companion for cnvs-specific work. No activation overlap in practice.

## Canonical sources

Skills are **also** served live at:

- [`https://cnvs.app/cnvs-whiteboard/SKILL.md`](https://cnvs.app/cnvs-whiteboard/SKILL.md)
- [`https://cnvs.app/mcp-listen/SKILL.md`](https://cnvs.app/mcp-listen/SKILL.md)
- [`https://cnvs.app/mcp-listen/scripts/listen.mjs`](https://cnvs.app/mcp-listen/scripts/listen.mjs)
- [`https://cnvs.app/mcp-listen/package.json`](https://cnvs.app/mcp-listen/package.json)

The cnvs.app URLs are the canonical install targets for curl-based installers; this GitHub repo is the reference for aggregators that crawl public sources (skills.sh, etc.) and for users who prefer git clone.

## Discovery surfaces

### Live

- **Official MCP Registry**: `app.cnvs/whiteboard` — [browse](https://registry.modelcontextprotocol.io/v0/servers?search=cnvs)
- **cnvs.app `/.well-known/mcp.json`** — links both skills
- **cnvs.app `/.well-known/mcp/server.json`** — MCP Registry entry with publisher-provided `_meta.skills[]`
- **cnvs.app `/llms.txt`** — LLM-friendly full reference
- **[`majiayu000/claude-skill-registry-core`](https://github.com/majiayu000/claude-skill-registry-core)** — `cnvs-whiteboard` listed (PR [#31](https://github.com/majiayu000/claude-skill-registry-core/pull/31) merged 2026-05-04). `mcp-listen` intentionally held back; see *Registry status* on the `mcp-listen/` section above.
- **Lobehub** (used by Hermes agent) — both skills imported; MCP server submitted

### Planned / under consideration

Notes for future expansion of distribution. Not active yet — kept here so the next maintenance window doesn't have to re-discover the landscape.

- **[`majiayu000/claude-skill-registry-core`](https://github.com/majiayu000/claude-skill-registry-core)** — re-submit `mcp-listen` as a separate PR now that PR [#40](https://github.com/majiayu000/claude-skill-registry-core/pull/40) (directory archives + bundled-script security scanning) is merged. `scripts/listen.mjs` is even hardcoded into their test assertions, so the pipeline already exercises our exact case.
- **[`daymade/claude-code-skills`](https://github.com/daymade/claude-code-skills)** (vendored model) — fork, copy `cnvs-whiteboard/` and `mcp-listen/` directly into their tree (their layout already expects `scripts/`/`references/`/`assets/`), update `marketplace.json`, single PR for both skills. No bundled-files concern because the files are copied in.
- **[`VoltAgent/awesome-agent-skills`](https://github.com/VoltAgent/awesome-agent-skills)** (curated awesome-list, 20k ⭐) — markdown link, ≤10-word description. Their CONTRIBUTING explicitly excludes brand-new skills ("give your skill time to mature and gain users before submitting"); revisit once there's documented external usage.
- **[`sickn33/antigravity-awesome-skills`](https://github.com/sickn33/antigravity-awesome-skills)** (36k ⭐) — manual path: fork, add `skills/<name>/SKILL.md`, run `npm run validate`. Their `<!-- registry-sync: ... -->` header in README suggests automated pull from upstream registries, so a successful entry on `majiayu000/claude-skill-registry-core` *may* propagate here without a separate PR — confirm before submitting twice.
- **[`agentskills/agentskills`](https://github.com/agentskills/agentskills)** (17.8k ⭐, the spec org behind agentskills.io) — investigate whether they accept reference implementations; `mcp-listen` as a worked example of MCP `resources/subscribe` consumption could fit there.
- **`vercel-labs/agent-skills`** / **`vercel-labs/skills`** — almost certainly curated, but read CONTRIBUTING before ruling out.

Skipped intentionally: `anthropics/skills` (curated, no community PRs); personal collections under ~100 ⭐; language-specific lists unless a relevant audience emerges.

## License

MIT. See [LICENSE](./LICENSE).
