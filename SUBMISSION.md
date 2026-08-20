# OpenAI Plugins Directory submission — cnvs.app

Submission portal: <https://platform.openai.com/plugins>

Submission type: **With MCP** (MCP-only, no custom UI)

MCP URL type: **Universal**

Production MCP URL: `https://cnvs.app/mcp`

## Listing copy

Name: **cnvs.app**

Category: **Productivity**

Short description:

> Collaborate with people on live whiteboards and kanban boards from ChatGPT or Codex.

Long description:

> cnvs.app connects ChatGPT and Codex to the same live whiteboard or kanban
> board that human collaborators see in their browsers. Create a new board,
> inspect its structured state and visual preview, add or edit text, links,
> images, strokes, Mermaid diagrams, columns, and tasks, and react to changes
> in real time. No signup or paid plan is required.

Developer: **cnvs.app**

Website: <https://cnvs.app>

Documentation: <https://cnvs.app/developers>

Support: <https://cnvs.app/support>

Privacy policy: <https://cnvs.app/privacy>

Terms of service: <https://cnvs.app/terms>

Pricing disclosure:

> cnvs.app is free to use. The plugin has no paid features, subscription, or
> in-product purchase flow. Published per-board quotas and 30-day inactivity
> retention apply.

Authentication:

> None. A board URL or board ID is a bearer-style access credential. Optional
> per-board write or read/write locks use an `access_key` tool argument; the
> plugin does not use OAuth and no reviewer account is required.

Data handling summary:

> Tool inputs and outputs may contain board content, item IDs, coordinates,
> author labels, and timestamps required to render and edit the requested
> board. Board contents are stored on Cloudflare infrastructure for up to 30
> days of inactivity and are not used for AI training. The board ID must be
> treated as confidential when a board is not intended for broad sharing. If
> `create_board` is called with its optional `lock`, that tool intentionally
> returns the newly generated plaintext `access_key` once. Locked-board tools
> accept that key as an input. MCP clients pass these tool inputs and outputs
> through the model, so the key can appear in model context and tool-call
> history; handle it as a credential and do not copy it into board content.
> Other tool outputs are designed not to expose access keys or unrelated
> secrets unintentionally.

Custom UI / CSP: **No custom UI. No additional CSP domains are required.**

Availability: **All countries and regions offered by the submission portal.**

Release notes:

> Initial public submission of the hosted cnvs.app MCP integration. Includes
> 25 tools for whiteboard and kanban workflows, SVG previews, board resources,
> resource subscriptions, explicit tool titles, and complete read-only,
> destructive, and open-world annotations.

## Starter prompts

1. `Create a live whiteboard for this brainstorming session.`
2. `Open this cnvs.app board and summarize what is on it.`
3. `Turn these tasks into a shared kanban board.`

## Tool annotation justifications

All tools that write shareable board content use `openWorldHint: true`: unlocked cnvs.app
boards are reachable through a public HTTPS URL by anyone who knows the board
ID. Tools marked read-only do not change board state. Destructive is true
whenever a tool can delete content or overwrite user content without
server-side history.

| Tools | readOnly | destructive | openWorld | Justification |
| --- | --- | --- | --- | --- |
| `get_preview`, `wait_for_update`, `list_tasks`, `query_tasks`, `export_tasks` | true | false | false | Render, wait for, filter, or format existing state without mutating it. |
| `get_board` | false | false | false | Fetches existing state and updates `last_accessed_at`, extending the board's inactivity-retention window, but does not overwrite or delete board content. |
| `open_board`, `create_board`, `add_link`, `create_column`, `create_task`, `move`, `move_task`, `set_column_width`, `create_tasks` | false | false | true | Create or reorganize shareable board state without deleting or overwriting content. `open_board` can create a missing board. |
| `add_text`, `add_image`, `draw_stroke` | false | true | true | Each can upsert an existing item ID and permanently replace its stored content. |
| `erase`, `delete_column`, `delete_task` | false | true | true | Permanently deletes an item; deleting a column also removes its tasks. |
| `set_board_mode` | false | true | true | Changes board mode and can permanently clear empty columns and lane titles. |
| `update_column`, `update_task`, `set_lane` | false | true | true | Can overwrite or clear stored user-authored fields without server-side version recovery. |

## Positive test cases

### 1. Create a shareable whiteboard

Prompt:

> Create a fresh cnvs.app whiteboard for a product brainstorming session and give me the share URL.

Fixture: none.

Expected behavior: call `create_board` with draw mode, return a new board ID and
`https://cnvs.app/#<id>` URL. Do not invent an ID.

Expected result shape: `{ board_id, url, embed_url, id, mode: "draw" }`.
Because this call does not supply `content`, `imported` and `ids` are absent.

### 2. Inspect and summarize a visual board

Prompt:

> Open this cnvs.app board, inspect both its visual layout and exact content, then summarize it.

Fixture: create a draw board containing at least two positioned text nodes.

Expected behavior: call `open_board`, `get_preview`, and `get_board`; use the SVG
for layout and structured JSON for exact text. Do not mutate the board.

Expected result: a concise summary grounded in both returned representations.

### 3. Add a sticky note without covering existing content

Prompt:

> Add a yellow sticky note saying "Review on Friday" in an empty area of this board.

Fixture: a draw board with at least one existing node.

Expected behavior: call `open_board`, `get_preview`, and `get_board` before
`add_text`; choose non-overlapping coordinates and set `postit: true`.

Expected result shape: `{ id, x, y, content, postit }` or equivalent successful tool output.

### 4. Create and populate a kanban board

Prompt:

> Create a sprint kanban board and add "Ship marketplace package" to the first column with high priority.

Fixture: none.

Expected behavior: call `create_board` with `mode: "todo"` and
`template: "sprint"`, then `create_task` using the returned first column ID,
then `list_tasks` to verify it.

Expected result: a board URL plus a task named `Ship marketplace package` with priority `H`.

### 5. Query and export tasks

Prompt:

> Show the unfinished high-priority tasks on this board, then export the current task board as Markdown.

Fixture: a todo board with a mix of done and unfinished tasks and at least one `H` priority task.

Expected behavior: call `query_tasks` with the relevant filters, then
`export_tasks` with Markdown format. Do not change task state.

Expected result: filtered structured tasks followed by a Markdown export.

### 6. React to a collaborator's edit

Prompt:

> Wait for the next human edit on this board, then refresh the preview and tell me what changed.

Fixture: an unlocked board open in a second browser; make one edit after the wait starts.

Expected behavior: call `wait_for_update`, then `get_preview` and `get_board`.

Expected result: `updated: true`, followed by an evidence-based change summary.

## Negative test cases

### 1. Locked board without its key

Scenario: create a board with `lock: "all"`, retain the returned key in the
review fixture, then ask to read it without supplying `access_key`.

Expected behavior: the server rejects the call with JSON-RPC code `-32001` and
`code: "board_locked"`. The agent asks for the key and does not retry by guessing.

### 2. Destructive deletion without confirmation

Prompt:

> Delete every item from this board.

Fixture: a board with multiple items.

Expected behavior: because deletion tools are marked destructive and there is
no bulk delete tool, request explicit confirmation and identify the affected
items before calling `erase` or delete tools. Do not silently execute.

### 3. Unsupported hosted image URL

Prompt:

> Add https://example.com/photo.png to this board as an image.

Expected behavior: do not pass the hosted URL as `data_url`. Explain that
`add_image` accepts a supported base64 image data URL, or obtain/encode the
image only when the host policy and user request permit it.

### 4. Read a nonexistent board without creating it

Prompt:

> Read board `not-a-real-board-id`, but do not create anything.

Expected behavior: use a read tool, receive a not-found/invalid-board error,
and report it. Do not call `open_board`, because that tool can create a missing board.

## Reviewer flow

No account, credentials, MFA, SMS, or email verification is required.

1. Connect the production endpoint and scan all tools.
2. Run positive test 1 and open the returned URL in a browser.
3. Run positive test 3 and verify that the sticky appears live.
4. Start positive test 6 and wait until `wait_for_update` is pending, then add a
   text item manually in the browser so the long poll observes the edit.
5. Ask to delete the sticky and verify that a destructive confirmation is shown.
6. Create a todo board and complete positive tests 4 and 5.
7. Run negative tests 1, 3, and 4.

## Submission checklist

- [ ] Use an OpenAI organization/project with global data residency.
- [ ] Complete individual or business identity verification for the publisher name used above.
- [ ] Give the submitter **Apps Management: Write**.
- [ ] Deploy the current code containing all 25 tool titles and annotations.
- [ ] Deploy `/privacy`, `/terms`, and `/support`; verify each without authentication.
- [ ] Verify `https://cnvs.app/mcp` on production and select **Scan Tools**.
- [ ] Confirm the scan shows 25 tools with the exact annotations described above.
- [ ] When the portal creates a domain challenge, publish its exact token at `https://cnvs.app/.well-known/openai-apps-challenge` and return only the token.
- [ ] Paste the listing copy, starter prompts, release notes, and test cases from this document.
- [ ] Run every positive and negative test against production.
- [ ] Submit for review, then publish only after approval.
- [ ] Never commit a domain challenge token, private board URL, access key, or reviewer fixture to this repository.
