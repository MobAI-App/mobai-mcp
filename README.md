# MobAI MCP Server

[![npm version](https://badge.fury.io/js/mobai-mcp.svg)](https://www.npmjs.com/package/mobai-mcp)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

MCP (Model Context Protocol) server for [MobAI](https://mobai.run) — AI-powered mobile device automation. Lets AI assistants (Claude Code, Cursor, Windsurf, Cline, and other MCP-compatible tools) control Android and iOS devices, emulators, and simulators via a single DSL-first interface.

## How it works

All device interaction is batched through one primary tool: **`execute_dsl`**. Instead of exposing dozens of fine-grained tools (tap, swipe, type…), the server accepts a JSON script describing a sequence of actions with predicates, assertions, waits, and conditional branches. This keeps round-trips low and encodes retry/failure strategies server-side.

A small set of companion tools handles device discovery, screenshots, app management, and running `.mob` test files.

## Prerequisites

- Node.js 18+
- [MobAI desktop app](https://mobai.run) running locally (HTTP API on `127.0.0.1:8686`)
- A connected Android or iOS device, emulator, or simulator

## Installation

### Claude Code

```bash
claude mcp add mobai -- npx -y mobai-mcp
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "mobai": {
      "command": "npx",
      "args": ["-y", "mobai-mcp"]
    }
  }
}
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "mobai": {
      "command": "npx",
      "args": ["-y", "mobai-mcp"]
    }
  }
}
```

### Windsurf / Cline / other MCP clients

The server speaks stdio — use your client's generic MCP configuration:

```json
{
  "command": "npx",
  "args": ["-y", "mobai-mcp"]
}
```

## Tools

### Device management

| Tool | Description |
|---|---|
| `list_devices` | List all connected Android and iOS devices |
| `get_device` | Get details about a specific device |
| `start_bridge` | Start the automation bridge on a device (required before interaction) |
| `stop_bridge` | Stop the automation bridge |

### Screenshots

| Tool | Description |
|---|---|
| `get_screenshot` | Fast, low-quality screenshot for LLM visual analysis (may be downscaled; response includes scale factor) |
| `save_screenshot` | Full-quality PNG to disk for reporting, debugging, or sharing |

### Apps

| Tool | Description |
|---|---|
| `list_apps` | List installed apps on the device |
| `install_app` | Install an `.apk` or `.ipa` from a local file path |
| `uninstall_app` | Uninstall an app by bundle ID / package name |
| `debug_app` | Launch an app in debug mode and write stdout/stderr to a log file |

### Automation

| Tool | Description |
|---|---|
| `execute_dsl` | **Primary tool.** Execute a batch of DSL steps: tap, type, swipe, observe, assertions, web automation, metrics, screen recording, and more. |

### Test management

Tests are `.mob` files on disk inside project directories. You read, write, and edit them directly using your assistant's filesystem tools — MobAI watches for changes and updates the UI live. MCP is only needed to discover projects and run tests.

| Tool | Description |
|---|---|
| `test_get_active` | Get the active test project directory and its `.mob` cases |
| `test_list_projects` | List all known test project directories with their `.mob` cases |
| `test_run` | Run a `.mob` test case on a device (`project_dir` + `case_path` + `device_id`) |

## Resources

Read these **before** attempting any device interaction — they describe the DSL schema, action set, predicates, failure strategies, and `.mob` syntax.

| URI | Purpose |
|---|---|
| `mobai://reference/device-automation` | How to control devices — guide, all DSL actions, predicates, and failure strategies |
| `mobai://reference/testing` | Testing workflow, rules, error fixes, and `.mob` script syntax |

## Example

Open the iOS Settings app, navigate to Wi-Fi, and verify the toggle exists:

```json
{
  "version": "0.2",
  "steps": [
    {"action": "open_app", "bundle_id": "com.apple.Preferences"},
    {"action": "wait_for", "predicate": {"text": "Settings"}, "timeout_ms": 3000},
    {"action": "tap", "predicate": {"text_contains": "Wi-Fi"}},
    {"action": "wait_for", "predicate": {"type": "switch"}, "timeout_ms": 3000},
    {"action": "assert_exists", "predicate": {"type": "switch"}},
    {"action": "observe", "include": ["ui_tree"]}
  ]
}
```

Pass this as the `commands` argument (a JSON string) to `execute_dsl` along with a `device_id` from `list_devices`.

## Troubleshooting

**"Connection refused"** — Make sure the MobAI desktop app is running and the API is reachable at `http://127.0.0.1:8686`.

**"Bridge not running"** — Call `start_bridge` first. The iOS bridge can take up to a minute to come up.

**Screenshots not visible** — `get_screenshot` saves to `/tmp/mobai/screenshots/` by default and returns the file path. Use your assistant's file-reading capability to view them. DSL `observe` screenshots are extracted from the response and saved to the same directory.

## Development

```bash
git clone https://github.com/MobAI-App/mobai-mcp.git
cd mobai-mcp
npm install
npm run build
node dist/index.js
```

## License

Apache 2.0 — see [LICENSE](LICENSE).
