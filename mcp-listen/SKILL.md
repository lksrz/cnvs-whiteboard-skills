---
name: mcp-listen
description: Helper-only push-to-model pump for Streamable-HTTP MCP servers with `capabilities.resources.subscribe: true`. Activates ONLY when the caller — a user or another skill — explicitly hands over both an MCP server URL and one or more resource URIs to subscribe to. Spawn under Claude Code's Monitor; emits one JSON line on stdout per `notifications/resources/updated` so every actionable push becomes an in-chat notification (connection / subscription / heartbeat / diagnostic events go to stderr by default; pass `--verbose` to route them to stdout too). Pair with the `cnvs-whiteboard` skill (which delegates its push channel here) or any other skill that already knows the MCP URL + resource URI it wants to watch. Do NOT auto-activate from generic phrasing like "watch this file", "stay in the loop", or "notify me on changes" — the caller must supply the MCP coordinates. Ships `--ignore-author` / `--ignore-author-prefix` flags for self-echo filtering on cnvs-shaped payloads (`texts[] / lines[] / images[]` with `author` + `last_updated`); on other resource shapes the filter silently no-ops and the caller filters downstream.
compatibility: Requires Node.js 18+ only — no npm, no dependencies (uses built-in fetch). Installed by the user, not the agent; see https://cnvs.app/docs/mcp#listen.
license: MIT
metadata:
  author: cnvs.app
  version: "0.4.0"
  homepage: https://cnvs.app/mcp-listen/
---

# mcp-listen

Minimal MCP notification pump. Opens a Streamable-HTTP session against an MCP server, subscribes to one or more resource URIs, and emits one JSON line per `notifications/resources/updated` event on stdout. Designed to be wrapped by Claude Code's `Monitor` tool so each event becomes a real-time notification to the model — no polling, no manual log tailing.

## When to use

**Helper-only — does not auto-activate from generic phrasing.** Trigger this skill only when the caller has already supplied two things:

1. **An MCP server URL** (e.g. `https://cnvs.app/mcp`).
2. **At least one resource URI** to subscribe to (e.g. `cnvs://board/<id>/state.json`).

Typical activation paths:

- **Another skill delegates push to it.** `cnvs-whiteboard` is the canonical example — it knows the MCP URL and the board's resource URI, and spawns this skill via `Monitor` to get push-to-model.
- **The user explicitly names both coordinates** ("subscribe to `cnvs://board/abc/state.json` on `https://cnvs.app/mcp` and notify me when it changes").
- **The user is debugging or building** an MCP server that advertises `capabilities.resources.subscribe: true` and wants to inspect live notifications.

Do NOT activate on vague phrasing like "watch this file", "stay in the loop on the project", "notify me when something changes". Those map to a different surface (filesystem watchers, git hooks, polling, webhooks). This skill is for the case where MCP subscriptions are already the chosen transport and the caller has the coordinates.

## Installation (user-run, never by the agent)

This skill is installed **by the user** following https://cnvs.app/docs/mcp#listen — pinned, immutable versioned URLs (`https://cnvs.app/mcp-listen/v0.4.0/...`) verified against a published `SHA256SUMS`. There is no npm step and no dependencies: `scripts/listen.mjs` uses only Node.js 18+ built-ins.

**Agents:** never download, install or update this skill yourself unless the user explicitly asks. If it isn't installed, offer it and link the page above. Zero-install fallback for cnvs.app boards: long-poll `GET https://cnvs.app/api/boards/<id>/wait?timeout_ms=25000` (returns `{updated, timedOut, etag}`; call again on timeout).

Check the installed version: `node scripts/listen.mjs --version`.

## Usage via Monitor

Pattern for Claude Code:

```
Monitor(
  command: "node ~/.claude/skills/mcp-listen/scripts/listen.mjs [--ignore-author <tag>]... [--verbose] <mcp-url> <resource-uri> [<uri> ...]",
  description: "watching <short name> for <event>",
  persistent: true
)
```

### Output split: actionable vs diagnostic (default since v0.3)

To keep `Monitor` from waking the model on listener bookkeeping, the script segregates its output:

- **stdout (actionable)** — only `resource_updated`. This is the event the model should react to: a remote resource you subscribed to changed.
- **stderr (diagnostic)** — `connected`, `subscribed`, `stream_open` / `stream_closed` (GET stream reopened on the same session), `still_watching` (~2 min heartbeat), `error` (transient transport error before reconnect), `filter_error` (parse/read failure during self-echo filtering on a non-cnvs payload).

`Monitor` notifies on stdout lines, so by default it only fires on real updates. The full diagnostic stream is still readable with `2>&1` if you want the legacy v0.2 behavior in a single channel, or just pass `--verbose` to route everything to stdout.

```
# default: only resource_updated wakes the model
node listen.mjs https://cnvs.app/mcp cnvs://board/<id>/state.json

# verbose: every event on stdout (legacy v0.2 behavior)
node listen.mjs --verbose https://cnvs.app/mcp cnvs://board/<id>/state.json
```

Only updates for the URIs you passed on the command line are emitted; pushes for other resources (cnvs.app also notifies `tasks.json` to every `state.json` subscriber) are dropped silently, so subscribe to each URI you actually want.

### Self-echo filter (opt-in, **cnvs-shaped payloads only**)

MCP subscriptions notify *every* subscriber — including the one whose write triggered the push. For a listener that ALSO writes to the same board, every one of its own writes would otherwise wake it as a notification, creating a feedback loop.

**Important limitation up front.** The filter is only applied when the target server returns snapshots shaped like cnvs.app (`texts[] / lines[] / images[]` each with `author` + `last_updated`). For any other MCP server the filter **silently no-ops** — every event is emitted unconditionally and the caller is responsible for filtering downstream. The flags still accept input (they don't error), but they have no effect on non-cnvs shapes.

Two flags opt into filtering (cnvs-shaped payloads):
- `--ignore-author <tag>` — exact match, repeatable. Pass the caller's own author tag (e.g. `ai:claude` for Claude Code, `ai:gpt` for a GPT-based agent, `user:xyz` for a specific human).
- `--ignore-author-prefix <prefix>` — prefix match, repeatable. `--ignore-author-prefix ai:` mutes every AI collaborator, useful when a human is driving and only wants to see human edits.

**No default** — the skill can't guess what tag the caller writes under. Pass explicitly. Both flags accept `""` (empty string) which no-ops, so wrapper scripts can safely inject a blank value when the feature isn't needed.

On each `resources/updated` (for cnvs-shaped snapshots) the skill does one `resources/read`, picks the latest-touched item across `texts`/`lines`/`images`, and if its `author` matches any rule it suppresses the notification.

Each emitted event carries a `trigger` block so the model sees *who* caused the push without a second fetch. The `connected` and `subscribed` lines below land on **stderr** since v0.3 (or stdout under `--verbose`); only the `resource_updated` line below reaches stdout by default:

```json
// → stderr (or stdout with --verbose)
{"ts":"...","event":"connected","mcpUrl":"https://cnvs.app/mcp","ignoreAuthors":["ai:claude"]}
{"ts":"...","event":"subscribed","uri":"cnvs://board/<id>/state.json"}
// → stdout (always)
{"ts":"...","event":"resource_updated","uri":"cnvs://board/<id>/state.json",
  "trigger":{"id":"31c081fb","author":"user:658ebc2c","kind":"text","last_updated":"2026-04-14 21:08:02"}}
```

Writes authored by ignored tags produce no output — the model is never woken for its own echoes (cnvs-shaped snapshots only; see limitation above).

## What to do on each notification

`event: "resource_updated"` is the trigger for action. Fetch the fresh state via whatever read tool/endpoint the target exposes (`resources/read` over MCP, or an HTTP equivalent) and react. The subscription is debounced server-side when the server implements bursts-to-one aggregation (cnvs.app does ~3 s), so one notification may cover multiple near-simultaneous edits.

## Reconnection

The script opens the `GET` SSE stream first and subscribes only once it is open, so no update falls into a gap. When the stream ends (servers cap stream lifetime — cnvs.app closes it every 15 min), drops, or goes 60 s without a single byte (cnvs.app sends a heartbeat every 25 s), the script reopens the `GET` on the **same session**: subscriptions are kept, nothing is re-sent. Only a lost session — `404` on any request, or `400`/`404`/`405` on the `GET` — triggers a full re-initialize: best-effort `DELETE` of the old session, new `initialize`, re-subscribe. Every request has a 30 s deadline; failures back off exponentially (1 s → 30 s cap). Server `ping` requests are answered. SIGINT/SIGTERM sends `DELETE` to tear the session down. Lifecycle events (`stream_open`, `stream_closed`, `error`, `connected`, `subscribed`) go to **stderr** (or stdout with `--verbose`) so the chat trail stays honest without waking the model on each reconnect. Stdout stays clean; only `resource_updated` events reach it.

## Gotchas

- **Monitor exits immediately after `connected` / `subscribed`.** The script keeps an explicit `still_watching` heartbeat `setInterval` alongside the SSE stream as keep-alive — don't remove it.
- **Subscribe succeeds but no `resource_updated` ever arrives.** This script accepts any `2xx` for notifications, but some other MCP clients insist on `202 Accepted` — irrelevant here. More likely the server never writes `notifications/resources/updated` onto the `GET` stream, or the stream keeps failing: run with `--verbose` and look for repeated `error` / `stream_closed` lines. Read-only probe of the stream endpoint (ask the user before probing a server they did not name): `curl -sN -H 'Accept: text/event-stream' -H 'Mcp-Session-Id: <id>' <server>/mcp` should stay open and print heartbeat comments.
- **Feedback loop: your own writes wake the listener.** You forgot `--ignore-author <your-tag>` (or the prefix variant). Add it.
- **"It looks like nothing is happening."** Since v0.3 only `resource_updated` reaches stdout by default. `connected` / `subscribed` / `still_watching` are on stderr. To see the full lifecycle in one channel use `2>&1` in the wrapper, or pass `--verbose` to merge everything onto stdout.
- **Works for any Streamable-HTTP MCP server with subscriptions** — not just cnvs.app. The cnvs-shaped `trigger` extraction falls through on non-board payloads and emits every event unfiltered.

## Limits

- One process per server. If you need to watch two different MCP servers, spawn two Monitors.
- Relies on the server correctly implementing MCP resource subscriptions. If unsure, check that its `initialize` result advertises `capabilities.resources.subscribe: true` (a plain `curl` POST of `initialize` shows it), or ask the user — do not install extra tooling to inspect it.
- Dies with the Claude Code session. For longer watches use cron jobs or a real systemd/launchd unit.

## Related skills

- **cnvs-whiteboard** ([SKILL.md](https://cnvs.app/cnvs-whiteboard/SKILL.md)) — complementary skill that teaches the agent how to read from and write to a cnvs.app whiteboard over REST. Pair the two when the remote state you're watching *is* a cnvs.app board: this skill gives you the push channel, cnvs-whiteboard gives you the mutation and render pipeline.
