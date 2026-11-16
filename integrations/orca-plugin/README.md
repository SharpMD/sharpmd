# SharpMD for Orca

An [Orca](https://orca.dev) plugin that connects to your [SharpMD](https://sharpmd.app) boards.

- Lists your SharpMD boards and shows each board's cards by column.
- **Start in Orca** on a card: creates an Orca workspace named after the card, starts an agent
  with the card text, its SharpMD location (`<board path> #<card id>`) and the instruction to move
  the card to the done column with the SharpMD MCP (`move_card`), then moves the card to the
  in-progress column if the board has one.
- If the card has a `repo` field, it picks the Orca project with that name or folder name.
  Otherwise you choose the repository in the panel.
- **Open SharpMD** opens the board note in your browser (desktop app only).

The agent you start needs the SharpMD MCP server configured on its own side so it can call
`move_card` (SharpMD, Settings, AI connection gives the URL and token).

## Token

Paste a SharpMD token in the panel the first time. It is stored with Orca's encrypted plugin
`secrets`, is never logged, and is never shown back or sent to the panel again. The panel has no
network access, so the plugin's worker makes every call to `https://sharpmd.app/mcp` (JSON-RPC over
POST, `Authorization: Bearer <token>`).

## Settings

Under the plugin in Orca's Settings: MCP URL (for a self-hosted SharpMD), the agent to start
(default `claude`), and the board note paths (one per line). With no paths, the plugin checks the
notes whose path contains `board`, `tablero` or `kanban`.

## Install

This plugin needs Orca 1.4.259 or newer and runs a worker, so Orca asks you to approve it
(secrets, settings, workspace read/create, agent launch, notifications).

From a local folder:

1. Settings, Plugins, **Turn on plugins**.
2. **Development folders...**, add this folder (the one with `orca-plugin.json`).
3. Review and enable it.

Or from a terminal: `orca plugin dev load <path-to-this-folder>`; it prints the approval
fingerprint to re-run with `--approve <fingerprint>`.

From a Git URL: put this folder at the root of its own Git repository, then run
`orca plugin install <owner/repo[@ref]>`. Orca installs a plugin from the repository root.

## Develop

No build step, no dependencies. `orca plugin validate .` checks the manifest.

## License

MIT, see [LICENSE](LICENSE).
