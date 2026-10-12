#!/usr/bin/env node
// mcp-listen v0.4.0 — dependency-free (Node.js 18+ built-ins only).
//
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
//   --version                     Print the version and exit.
//   --verbose                     Route diagnostic events (connected,
//                                 subscribed, stream_open, stream_closed,
//                                 still_watching, error,
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

// Transport: a hand-rolled Streamable-HTTP MCP client (no npm deps, so
// there is nothing to `npm install`): POST initialize (Mcp-Session-Id is
// used when the server issues one, optional otherwise) -> POST
// notifications/initialized -> open the GET SSE stream -> POST
// resources/subscribe per URI (stream first, so no update falls into the
// gap). POST responses may be plain JSON or a text/event-stream; both are
// handled. Every POST has a REQUEST_TIMEOUT_MS deadline; the GET stream is
// aborted after STREAM_IDLE_TIMEOUT_MS without a byte (servers send SSE
// heartbeats well inside that). Server `ping` requests are answered.
// When the GET stream ends (servers cap stream lifetime) or drops, it is
// reopened on the SAME session — subscriptions survive. Only a lost session
// (404 on any request, or 400/404/405 on the GET) triggers a full
// re-initialize: the old session gets a best-effort DELETE, then a fresh
// session is created and re-subscribed. Failures back off exponentially
// (1 s -> 30 s). SIGINT/SIGTERM sends DELETE to tear the session down.

const VERSION = "0.4.0";
const PROTOCOL_VERSION = "2025-06-18";

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
        } else if (a === "--version") {
            process.stdout.write(VERSION + "\n");
            process.exit(0);
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

// Deadline for every POST (including reading an SSE-delivered reply) and
// for the GET stream's response headers.
const REQUEST_TIMEOUT_MS = envMs("MCP_LISTEN_REQUEST_TIMEOUT_MS", 30_000);
// Abort + reopen the GET stream after this long without a single byte.
// cnvs.app sends an SSE heartbeat every 25 s, so 60 s means a dead socket.
const STREAM_IDLE_TIMEOUT_MS = envMs("MCP_LISTEN_STREAM_IDLE_MS", 60_000);
const BACKOFF_INITIAL_MS = 1000;
const BACKOFF_MAX_MS = 30_000;

function envMs(name, fallback) {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
}

// The session is gone server-side (404, or the GET stream refused): the
// only signal that makes the main loop re-initialize instead of simply
// reopening the GET stream on the current session.
class SessionLost extends Error {}

let sessionId = null;
let protocolVersion = PROTOCOL_VERSION;
let nextId = 1;
let needInit = true;
let subscribed = false;
let sessionLostPending = false;
let streamAbort = null;

function baseHeaders() {
    const h = { "MCP-Protocol-Version": protocolVersion };
    if (sessionId) h["Mcp-Session-Id"] = sessionId;
    return h;
}

// Incremental SSE parser (WHATWG event-stream rules): lines end in CRLF, LF
// or a lone CR (also when the CR and LF land in different chunks), `data:`
// lines of one event are joined with "\n", a blank line dispatches, lines
// starting with ":" are comments. Returns feed(text) -> array of the
// dispatched data payloads.
function createSseParser() {
    let buf = "";
    let data = [];
    let skipLf = false;
    return function feed(text) {
        const out = [];
        buf += text;
        let start = 0;
        for (let i = 0; i < buf.length; i++) {
            const c = buf[i];
            if (c !== "\r" && c !== "\n") continue;
            if (c === "\n" && skipLf && i === start) {
                skipLf = false;
                start = i + 1;
                continue;
            }
            skipLf = c === "\r";
            const line = buf.slice(start, i);
            start = i + 1;
            if (line === "") {
                if (data.length) out.push(data.join("\n"));
                data = [];
                continue;
            }
            if (line[0] === ":") continue;
            const colon = line.indexOf(":");
            const field = colon < 0 ? line : line.slice(0, colon);
            let value = colon < 0 ? "" : line.slice(colon + 1);
            if (value[0] === " ") value = value.slice(1);
            if (field === "data") data.push(value);
        }
        buf = buf.slice(start);
        if (buf.length) skipLf = false;
        return out;
    };
}

// Read SSE frames from a fetch body, calling onMessage(obj) for each `data`
// payload that is valid JSON. onMessage returning true stops reading and
// cancels the body (releases the connection). With idleMs, a stretch of
// that long without any bytes cancels the body and throws.
async function readSse(body, onMessage, { signal, idleMs } = {}) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const feed = createSseParser();
    let idle = false;
    let timer = null;
    const arm = () => {
        if (!idleMs) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
            idle = true;
            reader.cancel().catch(() => {});
        }, idleMs);
    };
    const abort = () => reader.cancel().catch(() => {});
    signal?.addEventListener("abort", abort, { once: true });
    let stopped = false;
    try {
        arm();
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            arm();
            for (const data of feed(decoder.decode(value, { stream: true }))) {
                let msg;
                try { msg = JSON.parse(data); } catch { continue; }
                if (await onMessage(msg) === true) {
                    stopped = true;
                    return;
                }
            }
        }
        if (idle) throw new Error(`stream idle for ${idleMs} ms`);
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (stopped) await reader.cancel().catch(() => {});
        try { reader.releaseLock(); } catch {}
    }
}

async function postRaw(msg, label) {
    const res = await fetch(mcpUrl, {
        method: "POST",
        headers: {
            ...baseHeaders(),
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(msg),
        // Covers the body read too: aborting fetch errors its stream.
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 404 && sessionId) {
        await res.body?.cancel().catch(() => {});
        throw new SessionLost(`${label}: session not found (404)`);
    }
    if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        throw new Error(`${label}: HTTP ${res.status}`);
    }
    return res;
}

// POST one JSON-RPC message. Requests resolve to `result` (or throw on a
// JSON-RPC error); notifications resolve to null on any 2xx.
async function post(method, params, { notification = false } = {}) {
    const id = notification ? undefined : nextId++;
    const msg = { jsonrpc: "2.0", method, ...(params ? { params } : {}), ...(id != null ? { id } : {}) };
    const res = await postRaw(msg, method);
    const sid = res.headers.get("mcp-session-id");
    if (method === "initialize" && sid) sessionId = sid;
    if (notification) {
        await res.body?.cancel().catch(() => {});
        return null;
    }
    let reply = null;
    const type = res.headers.get("content-type") || "";
    if (type.includes("text/event-stream")) {
        await readSse(res.body, (m) => {
            if (m && m.id === id && ("result" in m || "error" in m)) {
                reply = m;
                return true;
            }
            handleServerMessage(m);
            return false;
        });
    } else {
        const parsed = await res.json();
        reply = Array.isArray(parsed) ? parsed.find((m) => m?.id === id) : parsed;
    }
    if (!reply) throw new Error(`${method}: no response`);
    if (reply.error) throw new Error(`${method}: ${reply.error.message ?? JSON.stringify(reply.error)}`);
    return reply.result;
}

// A lost session discovered off the main loop (filter read, ping reply):
// flag it and abort the GET stream so the loop re-initializes.
function noteSessionLost(err) {
    emitDiagnostic({ event: "error", message: err.message });
    sessionLostPending = true;
    streamAbort?.abort();
}

// Server -> client requests: answer `ping` with an empty result, anything
// else with method-not-found. Responses are POSTed back on the session.
async function answerServerRequest(msg) {
    const reply = msg.method === "ping"
        ? { jsonrpc: "2.0", id: msg.id, result: {} }
        : { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
    try {
        const res = await postRaw(reply, `reply to ${msg.method}`);
        await res.body?.cancel().catch(() => {});
    } catch (err) {
        if (err instanceof SessionLost) noteSessionLost(err);
        else emitDiagnostic({ event: "error", message: err?.message ?? String(err) });
    }
}

// Notifications are processed in arrival order, but off the stream-reading
// path so a slow `resources/read` never stalls the SSE reader.
let handlerChain = Promise.resolve();
function handleServerMessage(msg) {
    if (!msg || typeof msg.method !== "string") return;
    if (msg.id != null) {
        answerServerRequest(msg);
        return;
    }
    if (msg.method !== "notifications/resources/updated") return;
    // Drop pushes for URIs we never subscribed to — some servers fan a
    // change out to sibling resources (cnvs also pushes tasks.json to every
    // state.json subscriber), and emitting those would wake the model on
    // its own writes because they carry no author to filter on.
    if (!uris.includes(msg.params?.uri)) return;
    handlerChain = handlerChain.then(() => onResourceUpdated(msg)).catch(() => {});
}

async function onResourceUpdated(notification) {
    const uri = notification.params?.uri ?? null;
    // Filter by author — fetch the resource and inspect the latest item.
    // The extra round-trip is cheap (one HTTP request every ~3 s worst
    // case) and prevents the "wake model on its own writes" loop.
    let trigger = null;
    const filteringOn = ignoreAuthors.length > 0 || ignorePrefixes.length > 0;
    if (uri && filteringOn) {
        try {
            const res = await post("resources/read", { uri });
            const body = res?.contents?.[0]?.text;
            if (typeof body === "string") {
                const snap = JSON.parse(body);
                trigger = extractTrigger(snap);
                if (trigger && isIgnored(trigger.author)) {
                    // Self-echo or otherwise ignored — do not emit.
                    return;
                }
            }
        } catch (err) {
            // The session expired under us: re-initialize (and still emit
            // below, unfiltered — over-notify rather than drop an update).
            if (err instanceof SessionLost) noteSessionLost(err);
            // On any other failure we fall through and still emit the
            // event, just without a trigger payload. Diagnostics never
            // reach stdout by default, so non-cnvs servers (where
            // parse/read routinely fails) don't pollute Monitor with
            // filter_error wake-ups.
            else emitDiagnostic({
                event: "filter_error",
                uri,
                message: err?.message ?? String(err),
            });
        }
    }
    emitActionable({ event: "resource_updated", uri, trigger });
}

async function deleteSession() {
    if (!sessionId) return;
    try {
        await fetch(mcpUrl, { method: "DELETE", headers: baseHeaders(), signal: AbortSignal.timeout(3000) });
    } catch {}
}

async function initialize() {
    // Best-effort teardown of the session we are abandoning.
    await deleteSession();
    sessionId = null;
    protocolVersion = PROTOCOL_VERSION;
    const init = await post("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "mcp-listen", version: VERSION },
    });
    if (typeof init?.protocolVersion === "string") protocolVersion = init.protocolVersion;
    await post("notifications/initialized", {}, { notification: true });
    emitDiagnostic({ event: "connected", mcpUrl, sessionId, ignoreAuthors, ignorePrefixes });
}

// Open the GET stream on the current session and read it until it ends.
// Subscribes (once per session) only after the stream is open, so an
// update can't land in a window with nowhere to be delivered.
async function listen() {
    sessionLostPending = false;
    const ac = new AbortController();
    streamAbort = ac;
    const headerTimer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
    let res;
    try {
        res = await fetch(mcpUrl, {
            method: "GET",
            headers: { ...baseHeaders(), Accept: "text/event-stream" },
            signal: ac.signal,
        });
    } finally {
        clearTimeout(headerTimer);
    }
    if (res.status === 400 || res.status === 404 || res.status === 405) {
        await res.body?.cancel().catch(() => {});
        throw new SessionLost(`stream: HTTP ${res.status}`);
    }
    if (!res.ok || !res.body) throw new Error(`stream: HTTP ${res.status}`);
    emitDiagnostic({ event: "stream_open" });

    const reading = readSse(res.body, (m) => {
        handleServerMessage(m);
        return false;
    }, { signal: ac.signal, idleMs: STREAM_IDLE_TIMEOUT_MS });
    reading.catch(() => {});

    // Liveness heartbeat: every 2 minutes emit a "still_watching" line so
    // silence upstream is easy to spot.
    const hb = setInterval(() => emitDiagnostic({ event: "still_watching" }), 120_000);
    try {
        if (!subscribed) {
            try {
                for (const uri of uris) {
                    await post("resources/subscribe", { uri });
                    emitDiagnostic({ event: "subscribed", uri });
                }
                subscribed = true;
            } catch (err) {
                ac.abort();
                throw err;
            }
        }
        await reading;
    } finally {
        clearInterval(hb);
    }
    if (sessionLostPending) throw new SessionLost("session lost");
}

let shuttingDown = false;
async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    streamAbort?.abort();
    await deleteSession();
    process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

let backoffMs = BACKOFF_INITIAL_MS;
while (!shuttingDown) {
    const startedAt = Date.now();
    let closedNormally = false;
    try {
        if (needInit) {
            await initialize();
            needInit = false;
            subscribed = false;
        }
        await listen();
        closedNormally = true;
        emitDiagnostic({ event: "stream_closed", message: "reopening on the same session" });
    } catch (err) {
        if (shuttingDown) break;
        if (err instanceof SessionLost || sessionLostPending) needInit = true;
        emitDiagnostic({ event: "error", message: err?.message ?? String(err), reinitialize: needInit });
    }
    // A stream that stayed up for a while resets the backoff, and a normal
    // close after that (server lifetime cap) reopens immediately.
    const ranLong = Date.now() - startedAt > 60_000;
    if (ranLong) backoffMs = BACKOFF_INITIAL_MS;
    if (shuttingDown || (ranLong && closedNormally)) continue;
    await new Promise((r) => setTimeout(r, backoffMs));
    backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
}
