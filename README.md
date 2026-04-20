# cnvs-whiteboard-skills

Agent Skills for [cnvs.app](https://cnvs.app) — the free, no-signup real-time collaborative whiteboard with a live Model Context Protocol (MCP) endpoint.

Two related skills, published under the [agentskills.io](https://agentskills.io/specification) open standard so they work in any compatible runtime (Claude Code, Claude Desktop, OpenAI Codex / OpenCode, Cursor, Aider with MCP plugin, etc.).

## Skills in this repo

### [`cnvs-whiteboard/`](./cnvs-whiteboard/SKILL.md) — PRIMARY

Teaches an AI agent how to collaborate on a cnvs.app board in real time:

- Read the shared canvas state
- Draw / diagram / flowchart / annotate — add, update, move, and delete text, links, sticky notes, strokes, images, and Mermaid diagrams (flowcharts, sequence / class / ER diagrams, mind maps, gantt charts, concept maps)
- Render the SVG preview when the board contains drawings
- Subscribe to live human edits via MCP, react via REST

Activates on any cnvs.app board reference (URL `https://cnvs.app/#<id>`, `cnvs://board/<id>/...`, or a bare board ID) or phrases like "collaborate on / draw / diagram / annotate / watch a shared whiteboard or canvas."

### [`mcp-listen/`](./mcp-listen/SKILL.md) — GENERIC

Push-to-model pump for **any** Streamable-HTTP MCP server with subscriptions. Opens a session, subscribes to the given resource URIs, and emits one JSON line per `notifications/resources/updated` event on stdout — designed to be wrapped by Claude Code's `Monitor` tool so every server push becomes an in-chat notification (no polling, no log tailing).

Not cnvs-specific. Works against file watchers, remote queues, task runners, anything exposing `resources/subscribe` over MCP. `cnvs-whiteboard` delegates its push channel here.

## Install (Claude Code)

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

Alternatively clone this repo and `cp -r .claude/skills/* ~/.claude/skills/` — the `.claude/skills/` directory contains symlinks into `cnvs-whiteboard/` and `mcp-listen/` for Claude Code's expected layout.

## Install (Claude Desktop / any MCP client)

The MCP server is already published in the official [MCP Registry](https://registry.modelcontextprotocol.io) as `app.cnvs/whiteboard` — just add the remote:

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

The skills are optional documentation — the MCP server works on its own. The skills teach the agent *how* to use it well (preview-before-JSON, REST-over-MCP-for-writes, author-tag conventions, subscription-then-react loop).

## Spec compliance

Both skills follow [agentskills.io spec](https://agentskills.io/specification):

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

- **Official MCP Registry**: `app.cnvs/whiteboard` — [browse](https://registry.modelcontextprotocol.io/v0/servers?search=cnvs)
- **cnvs.app `/.well-known/mcp.json`** — links both skills
- **cnvs.app `/.well-known/mcp/server.json`** — MCP Registry entry with publisher-provided `_meta.skills[]`
- **cnvs.app `/llms.txt`** — LLM-friendly full reference
- **Community skill registries** — `daymade/claude-code-skills`, `majiayu000/claude-skill-registry` (submitted)

## License

MIT. See [LICENSE](./LICENSE).
