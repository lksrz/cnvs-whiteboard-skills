# Cursor Marketplace submission — cnvs.app

Submission URL: <https://cursor.com/marketplace/publish>

Public repository URL:

```text
https://github.com/lksrz/cnvs-whiteboard-skills
```

The files in this directory are the Cursor overlay for that public
MIT-licensed repository. Before either marketplace submission, publish it
together with the inspectable OpenAI/Codex package from `plugins/cnvs/`.
The public repository's default branch must contain:

```text
.codex-plugin/plugin.json
.cursor-plugin/plugin.json
.mcp.json
mcp.json
SUBMISSION.md
assets/icon.png
assets/logo.png
README.md
LICENSE
```

Copy `.cursor-plugin/plugin.json`, `mcp.json`, and `assets/logo.png` from this
directory. Copy `.codex-plugin/plugin.json`, `.mcp.json`, `SUBMISSION.md`, and
`assets/icon.png` from `plugins/cnvs/`. Merge the cnvs.app documentation from
`plugins/cnvs/README.md` into the public repository's existing `README.md`,
retain its existing MIT `LICENSE`, and add this checklist at its root. Do not
replace the existing README or license blindly. The prepared Codex manifest
intentionally omits its optional `repository` field. First commit and push the
combined package, then verify the files are publicly inspectable. Before final
submission, add the public repository URL to the manifest in the public repo
only if the submission directory requests that field; validate, commit, push,
and verify the public manifest again. Otherwise leave the optional field
omitted.

## Listing copy

Name: **cnvs.app**

Category: **Productivity**

Short description:

> Create, inspect, and edit live collaborative whiteboards and kanban boards over MCP.

Long description:

> cnvs.app connects Cursor to a free, no-signup collaborative whiteboard and
> kanban board. Create a board, inspect its structured content and SVG preview,
> add or edit text, links, images, strokes, Mermaid diagrams, columns, and
> tasks, and react to changes made by people viewing the same board URL.

Publisher: **cnvs.app**

Website: <https://cnvs.app>

Documentation: <https://cnvs.app/developers>

Support: <https://cnvs.app/support>

Privacy policy: <https://cnvs.app/privacy>

Terms of service: <https://cnvs.app/terms>

Pricing disclosure:

> The Cursor plugin and cnvs.app service are free to use. There are no paid
> features, subscriptions, or in-product purchases. Published board quotas and
> 30-day inactivity retention apply.

Authentication disclosure:

> No account or OAuth is required. A board URL or board ID is a bearer-style
> access credential. Optional per-board write or read/write locks accept a
> short access key through the MCP tool's `access_key` argument.

Risk disclosure:

> Unlocked boards are unlisted, not private: anyone who knows the URL can open
> them. Write tools change the live board seen by collaborators. Delete and
> overwrite tools are explicitly annotated as destructive and should require
> review or confirmation under the user's Cursor Run Mode.

## Reviewer test flow

No account or credentials are required.

1. Clone the public repository into `~/.cursor/plugins/local/cnvs` or symlink it there.
2. Run **Developer: Reload Window** and confirm **cnvs.app** appears in **Customize**.
3. Confirm the `cnvs` MCP server connects to `https://cnvs.app/mcp` without OAuth.
4. Ask: `Create a fresh cnvs.app whiteboard and give me the share URL.`
5. Open that URL in a browser and ask Cursor: `Inspect the preview and add a yellow sticky saying Cursor review OK in empty space.`
6. Verify the sticky appears in the browser and does not overlap existing content.
7. Ask Cursor to wait for the next edit with `wait_for_update`. After the tool
   call is confirmed pending, add a second note manually in the browser; verify
   the wait returns the edit, then ask Cursor to summarize the refreshed board.
8. Ask Cursor to delete the first sticky. Verify the tool arguments are shown and the destructive call requires the review appropriate to the active Run Mode.
9. Ask: `Create a sprint kanban board, add one high-priority task, and list all unfinished high-priority tasks.`
10. Verify the new board and task in a browser.

## Local validation

```bash
ln -s /path/to/cnvs-whiteboard-skills ~/.cursor/plugins/local/cnvs
```

After **Developer: Reload Window**, verify the plugin in **Customize** and check
the **MCP Logs** output channel if the remote server does not connect.

## Submission checklist

- [ ] Copy the Cursor overlay and the OpenAI/Codex files listed above to the public repository's default branch.
- [ ] Commit and push the package while the prepared Codex manifest still omits its optional `repository` field.
- [ ] Confirm `.codex-plugin/plugin.json`, `.mcp.json`, `SUBMISSION.md`, and `assets/icon.png` are publicly inspectable in `lksrz/cnvs-whiteboard-skills`.
- [ ] If required for submission, add the verified public URL as `repository` in the public manifest, validate it, commit, push, and verify it again; otherwise leave the field omitted.
- [ ] Merge the cnvs.app README content into the existing public README and retain the existing MIT license.
- [ ] Keep the public repository MIT licensed and ensure every shipped plugin file is inspectable.
- [ ] Update its README tool/resource counts to the current production surface (25 tools) before submission.
- [ ] Deploy the current MCP tool titles and annotations.
- [ ] Deploy and verify `/privacy`, `/terms`, and `/support` without authentication.
- [ ] Confirm `https://cnvs.app/mcp` connects from a clean Cursor installation.
- [ ] Complete the reviewer flow above, including one read, one write, one live update, and one destructive confirmation.
- [ ] Confirm no board URL, access key, token, or private reviewer fixture is committed.
- [ ] Submit `https://github.com/lksrz/cnvs-whiteboard-skills` at <https://cursor.com/marketplace/publish>.
