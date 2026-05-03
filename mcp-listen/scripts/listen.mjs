#!/usr/bin/env node
// Minimal MCP notification pump: connect to a Streamable-HTTP MCP server,
// subscribe to one or more resources, and emit one JSON line per incoming
// `notifications/resources/updated` event on stdout. Designed to be spawned
// under Claude Code's `Monitor` tool so each event becomes an in-chat
// notification.
//
// Usage:
//   node listen.mjs [flags] <mcp-url> <resource-uri> [<resource-uri> ...]
//
// Flags:
//   --ignore-author <tag>         Suppress notifications whose triggering
//                                 item was authored by this exact tag.
//                                 Repeatable. No default — the skill can't
//                                 guess what tag the caller writes under
//                                 (ai:claude, ai:gpt, ai:mybot, ...). For
//                                 Claude Code callers pass "ai:claude".
//   --ignore-author-prefix <p>    Suppress notifications whose triggering
//                                 item was authored by anything starting
//                                 with this prefix. Repeatable. Common:
//                                 --ignore-author-prefix "ai:" to mute
//                                 every AI collaborator, not just yourself.
//   --verbose                     Route diagnostic events (connected,
//                                 subscribed, still_watching, error,
//                                 filter_error) to stdout alongside the
//                                 actionable resource_updated events.
//                                 Default: only resource_updated reaches
//                                 stdout; diagnostics go to stderr so a
//                                 wrapping Monitor only fires on real
//                                 updates and not on connection chatter.
//
// Filtering strategy: on each `resources/updated` we `resources/read` the
// URI, parse the JSON, pick the item with the latest `last_updated` across
// `texts`/`lines`/`images`, and if its `author` matches any ignore rule
// we suppress the notification. Each emitted event includes a `trigger`
// field so the model sees who/what caused the push without a second fetch.
//
// Without any --ignore-* flags the skill emits every event unconditionally
// (the generic, safe default). Self-wake-loop prevention is the caller's
// job — for agentic use always pass the caller's own author tag explicitly.
//
// This filter is tuned for cnvs.app-shaped resources; for servers with a
// different snapshot shape it falls back to emitting unconditionally.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

function parseArgs(argv) {
    const positional = [];
    const ignoreAuthors = [];
    const ignorePrefixes = [];
    let verbose = false;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--ignore-author") {
            const v = argv[++i];
            if (v == null) {
                process.stderr.write("--ignore-author needs a value\n");
                process.exit(1);
            }
            if (v !== "") ignoreAuthors.push(v);
        } else if (a === "--ignore-author-prefix") {
            const v = argv[++i];
            if (v == null) {
                process.stderr.write("--ignore-author-prefix needs a value\n");
                process.exit(1);
            }
            if (v !== "") ignorePrefixes.push(v);
        } else if (a === "--verbose" || a === "-v") {
            verbose = true;
        } else {
            positional.push(a);
        }
    }
    return { ignoreAuthors, ignorePrefixes, verbose, positional };
}

function isIgnored(author) {
    if (typeof author !== "string") return false;
    if (ignoreAuthors.includes(author)) return true;
    for (const p of ignorePrefixes) if (author.startsWith(p)) return true;
    return false;
}

const { ignoreAuthors, ignorePrefixes, verbose, positional } = parseArgs(process.argv.slice(2));
const [mcpUrl, ...uris] = positional;
if (!mcpUrl || uris.length === 0) {
    process.stderr.write("usage: listen.mjs [--ignore-author <tag>]... [--verbose] <mcp-url> <resource-uri> [uri ...]\n");
    process.exit(1);
}

// Actionable events go to stdout — one line = one Monitor notification
// to the model. Reserved for resource_updated, the only event that should
// wake the model on a default invocation.
function emitActionable(event) {
    process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n");
}

// Diagnostic events (connected, subscribed, still_watching, error,
// filter_error) describe the listener's own lifecycle, not a remote
// resource change. They go to stderr so the wrapping Monitor only fires
// on actionable updates. With --verbose they go to stdout instead, for
// callers that want the full event trail (debugging, log capture, etc.).
function emitDiagnostic(event) {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
    (verbose ? process.stdout : process.stderr).write(line);
}

// Pick the most recently touched item in a cnvs.app-shaped snapshot.
// Returns null when the snapshot doesn't look like one (so the caller
// can fall back to emitting unconditionally).
function extractTrigger(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return null;
    const pools = [snapshot.texts, snapshot.lines, snapshot.images];
    if (!pools.every(Array.isArray)) return null;
    let latest = null;
    for (const pool of pools) {
        for (const item of pool) {
            if (!latest || (item.last_updated ?? "") > (latest.last_updated ?? "")) {
                latest = item;
            }
        }
    }
    if (!latest) return null;
    const kind = latest.points != null ? "line"
        : (latest.dataUrl !== undefined || latest.data_url !== undefined) ? "image"
        : (latest.kind === "link" ? "link" : "text");
    return {
        id: latest.id ?? null,
        author: latest.author ?? null,
        kind,
        last_updated: latest.last_updated ?? null,
    };
}

async function connectAndListen() {
    const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
    const client = new Client(
        { name: "mcp-listen", version: "0.3.0" },
        { capabilities: {} }
    );

    // Register handler BEFORE connect so no initial burst races us.
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, async (notification) => {
        const uri = notification.params?.uri ?? null;
        // Filter by author — fetch the resource and inspect the latest item.
        // The extra round-trip is cheap (one HTTP request every ~3 s worst
        // case) and prevents the "wake model on its own writes" loop.
        let trigger = null;
        const filteringOn = ignoreAuthors.length > 0 || ignorePrefixes.length > 0;
        if (uri && filteringOn) {
            try {
                const res = await client.readResource({ uri });
                const body = res.contents?.[0]?.text;
                if (typeof body === "string") {
                    const snap = JSON.parse(body);
                    trigger = extractTrigger(snap);
                    if (trigger && isIgnored(trigger.author)) {
                        // Self-echo or otherwise ignored — do not emit.
                        return;
                    }
                }
            } catch (err) {
                // On any failure we fall through and still emit the event,
                // just without a trigger payload — better to over-notify
                // than to swallow an update silently. Diagnostics never
                // reach stdout by default, so non-cnvs servers (where
                // parse/read routinely fails) don't pollute Monitor with
                // filter_error wake-ups.
                emitDiagnostic({
                    event: "filter_error",
                    uri,
                    message: err?.message ?? String(err),
                });
            }
        }
        emitActionable({ event: "resource_updated", uri, trigger });
    });

    await client.connect(transport);
    emitDiagnostic({ event: "connected", mcpUrl, ignoreAuthors, ignorePrefixes });

    for (const uri of uris) {
        await client.subscribeResource({ uri });
        emitDiagnostic({ event: "subscribed", uri });
    }

    // Keep the process alive. The SDK's own SSE handle does NOT always keep
    // Node from exiting (observed empirically), so we run an explicit timer
    // as our keep-alive. The timer ALSO acts as a liveness heartbeat — every
    // N minutes we emit a "still_watching" line so the monitor chain has a
    // periodic pulse and silence on the upstream server is easy to spot.
    return await new Promise((resolve, reject) => {
        const heartbeatMs = 120_000;
        const hb = setInterval(() => {
            emitDiagnostic({ event: "still_watching" });
        }, heartbeatMs);
        client.onerror = (err) => {
            clearInterval(hb);
            reject(err instanceof Error ? err : new Error(String(err)));
        };
        client.onclose = () => {
            clearInterval(hb);
            reject(new Error("client closed"));
        };
        transport.onerror = client.onerror;
        transport.onclose = client.onclose;
    });
}

let backoffMs = 1000;
while (true) {
    try {
        await connectAndListen();
    } catch (err) {
        emitDiagnostic({ event: "error", message: err?.message ?? String(err) });
        await new Promise((r) => setTimeout(r, backoffMs));
        backoffMs = Math.min(backoffMs * 2, 30_000);
        continue;
    }
    backoffMs = 1000;
}
