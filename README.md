# MobAI MCP Server

[![npm version](https://badge.fury.io/js/mobai-mcp.svg)](https://www.npmjs.com/package/mobai-mcp)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

MCP (Model Context Protocol) server for [MobAI](https://mobai.run) - AI-powered mobile device automation. This server enables AI coding assistants like Cursor, Windsurf, Cline, and other MCP-compatible tools to control Android and iOS devices, emulators, and simulators.

## Features

- **Device Control**: List, connect, and manage Android/iOS devices
- **UI Automation**: Tap, type, swipe, and interact with native apps
- **Web Automation**: Control Safari/Chrome and WebViews with CSS selectors
- **DSL Batch Execution**: Execute multiple automation steps efficiently
- **AI Agent**: Run autonomous agents to complete complex tasks
- **Screenshot Capture**: Capture and save device screenshots

## Prerequisites

- Node.js 18+
- [MobAI desktop app](https://mobai.run) running locally (provides the HTTP API on port 8686)
- Connected Android or iOS device (or emulator/simulator)

## Installation & Configuration

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

Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

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

### Windsurf

Add to Windsurf MCP config:

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

### Cline / Other MCP Clients

Configure according to your client's MCP server setup. The server uses stdio transport.

```json
{
  "command": "npx",
  "args": ["-y", "mobai-mcp"]
}
```

## Available Tools

### Device Management
- `list_devices` - List all connected devices
- `get_device` - Get device information
- `start_bridge` - Start on-device automation bridge
- `stop_bridge` - Stop automation bridge

### UI Automation
- `get_screenshot` - Capture device screenshot
- `get_ui_tree` - Get accessibility tree (supports text_regex and bounds filtering)
- `tap` - Tap element by index or coordinates
- `type_text` - Type text
- `swipe` - Perform swipe gesture
- `go_home` - Navigate to home screen
- `launch_app` - Launch app by bundle ID
- `list_apps` - List installed apps

### DSL Execution
- `execute_dsl` - Execute batch automation script

### AI Agent
- `run_agent` - Run autonomous agent for complex tasks

### Web Automation
- `web_list_pages` - List browser tabs/WebViews
- `web_navigate` - Navigate to URL
- `web_get_dom` - Get DOM tree
- `web_click` - Click element by CSS selector
- `web_type` - Type into element by CSS selector
- `web_execute_js` - Execute JavaScript

### Low-Level
- `http_request` - Make raw HTTP request to MobAI API

## Available Resources

- `mobai://api-reference` - Complete API documentation
- `mobai://dsl-guide` - DSL batch execution guide
- `mobai://native-runner` - Native app automation guide
- `mobai://web-runner` - Web automation guide

## Example Usage

### List devices and take screenshot

```
Use the list_devices tool to see connected devices.
Then use get_screenshot with the device ID.
```

### Automate Settings app

```
Use execute_dsl with:
{
  "version": "0.2",
  "steps": [
    {"action": "open_app", "bundle_id": "com.apple.Preferences"},
    {"action": "delay", "duration_ms": 1000},
    {"action": "observe", "context": "native", "include": ["ui_tree"]},
    {"action": "tap", "predicate": {"text_contains": "General"}}
  ]
}
```

### Run AI agent

```
Use run_agent with device_id and task: "Open Settings and enable WiFi"
```

## Comparison with Claude Code Plugin

| Feature | Claude Code Plugin | MCP Server |
|---------|-------------------|------------|
| Platform | Claude Code only | Any MCP client |
| Tools | http_request (generic) | Named tools + http_request |
| Resources | Skills (markdown) | MCP resources |
| Setup | Plugin install | npx |

The MCP server provides the same functionality as the Claude Code plugin but works with any MCP-compatible AI tool.

## Troubleshooting

### "Connection refused" error
- Ensure MobAI desktop app is running
- Check that API is available at http://127.0.0.1:8686

### "Bridge not running" error
- Use `start_bridge` tool first before automation
- iOS bridge may take up to 60 seconds to start

### Screenshots not visible
- Screenshots are saved to `/tmp/mobai/screenshots/`
- Use your AI tool's file reading capability to view them

## Development

```bash
# Clone the repository
git clone https://github.com/MobAI-App/mobai-mcp.git
cd mobai-mcp

# Install dependencies
npm install

# Build
npm run build

# Run locally
node dist/index.js
```

## License

Apache 2.0 - see [LICENSE](LICENSE) for details.
