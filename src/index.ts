#!/usr/bin/env node
/**
 * MobAI MCP Server
 *
 * Provides tools for AI-powered mobile device automation through the MobAI HTTP API.
 * Works with both Android and iOS devices, emulators, and simulators.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";

const API_BASE_URL = "http://127.0.0.1:8686/api/v1";
const DEFAULT_TIMEOUT_MS = 600000; // 10 minutes
const SCREENSHOT_DIR = "/tmp/mobai/screenshots";

// Ensure screenshot directory exists
function ensureScreenshotDir(): void {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
}

// Save base64 screenshot to file, return path
function saveBase64Screenshot(base64Data: string, prefix: string = "mcp"): string | null {
  if (!base64Data || base64Data.length <= 200 || base64Data.startsWith("/")) {
    return null;
  }
  ensureScreenshotDir();
  const filename = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const filePath = path.join(SCREENSHOT_DIR, filename);
  fs.writeFileSync(filePath, Buffer.from(base64Data, "base64"));
  return filePath;
}

// Process screenshot response: save base64 to file, return path
function processScreenshotResponse(body: any): any {
  if (body?.data && body?.format === "png" && !body?.path) {
    ensureScreenshotDir();
    const filename = `screenshot-${Date.now()}.png`;
    const filePath = path.join(SCREENSHOT_DIR, filename);
    fs.writeFileSync(filePath, Buffer.from(body.data, "base64"));
    return { path: filePath, format: "png", screenshot_saved: true };
  }
  return body;
}

// Process DSL response: find and save embedded screenshots
function processDslResponse(body: any): any {
  if (!body?.step_results) return body;

  for (const step of body.step_results) {
    const native = step.result?.observations?.native;
    if (native?.screenshot && !native.screenshot_saved) {
      const filePath = saveBase64Screenshot(native.screenshot, "observe");
      if (filePath) {
        native.screenshot = filePath;
        native.screenshot_saved = true;
      }
    }

    if (step.debug?.screenshot && !step.debug.screenshot_saved) {
      const filePath = saveBase64Screenshot(step.debug.screenshot, "debug");
      if (filePath) {
        step.debug.screenshot = filePath;
        step.debug.screenshot_saved = true;
      }
    }
  }
  return body;
}

// Process response body
function processResponseBody(body: any, url: string): any {
  if (url.includes("/screenshot")) {
    return processScreenshotResponse(body);
  }
  if (url.includes("/dsl/execute")) {
    return processDslResponse(body);
  }
  return body;
}

// Make HTTP request to MobAI API
async function makeRequest(
  method: string,
  endpoint: string,
  body?: any,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<{ status: number; statusText: string; body: any }> {
  const url = endpoint.startsWith("http") ? endpoint : `${API_BASE_URL}${endpoint}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fetchOptions: RequestInit = {
      method,
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    };

    if (body && ["POST", "PUT", "PATCH"].includes(method)) {
      fetchOptions.body = typeof body === "string" ? body : JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);
    clearTimeout(timeoutId);

    const responseText = await response.text();
    let responseBody: any;

    try {
      responseBody = JSON.parse(responseText);
      responseBody = processResponseBody(responseBody, url);
    } catch {
      responseBody = responseText;
    }

    return {
      status: response.status,
      statusText: response.statusText,
      body: responseBody,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

// Create the MCP server
const server = new Server(
  {
    name: "mobai",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// Tool definitions
const TOOLS = [
  {
    name: "list_devices",
    description: "List all connected Android and iOS devices, emulators, and simulators",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_device",
    description: "Get information about a specific device",
    inputSchema: {
      type: "object" as const,
      properties: {
        device_id: {
          type: "string",
          description: "Device ID (serial for Android, UDID for iOS)",
        },
      },
      required: ["device_id"],
    },
  },
  {
    name: "start_bridge",
    description: "Start the on-device bridge (accessibility service on Android, WebDriverAgent on iOS). Required before automation.",
    inputSchema: {
      type: "object" as const,
      properties: {
        device_id: {
          type: "string",
          description: "Device ID",
        },
      },
      required: ["device_id"],
    },
  },
  {
    name: "stop_bridge",
    description: "Stop the on-device bridge",
    inputSchema: {
      type: "object" as const,
      properties: {
        device_id: {
          type: "string",
          description: "Device ID",
        },
      },
      required: ["device_id"],
    },
  },
  {
    name: "get_screenshot",
    description: "Capture a screenshot from the device. Returns the file path to the saved PNG.",
    inputSchema: {
      type: "object" as const,
      properties: {
        device_id: {
          type: "string",
          description: "Device ID",
        },
      },
      required: ["device_id"],
    },
  },
  {
    name: "get_ui_tree",
    description: "Get the UI accessibility tree showing all visible elements with indices for tapping",
    inputSchema: {
      type: "object" as const,
      properties: {
        device_id: {
          type: "string",
          description: "Device ID",
        },
        verbose: {
          type: "boolean",
          description: "Include detailed elements array with bounds (default: false)",
        },
        only_visible: {
          type: "boolean",
          description: "Filter to only visible elements (default: true)",
        },
        include_keyboard: {
          type: "boolean",
          description: "Include keyboard elements in the tree (default: false). Useful for interacting with on-screen keyboards.",
        },
      },
      required: ["device_id"],
    },
  },
  {
    name: "tap",
    description: "Tap an element by index (from UI tree) or coordinates",
    inputSchema: {
      type: "object" as const,
      properties: {
        device_id: {
          type: "string",
          description: "Device ID",
        },
        index: {
          type: "number",
          description: "Element index from UI tree (preferred)",
        },
        x: {
          type: "number",
          description: "X coordinate (use with y instead of index)",
        },
        y: {
          type: "number",
          description: "Y coordinate (use with x instead of index)",
        },
      },
      required: ["device_id"],
    },
  },
  {
    name: "type_text",
    description: "Type text on the device (tap input field first to focus)",
    inputSchema: {
      type: "object" as const,
      properties: {
        device_id: {
          type: "string",
          description: "Device ID",
        },
        text: {
          type: "string",
          description: "Text to type",
        },
      },
      required: ["device_id", "text"],
    },
  },
  {
    name: "swipe",
    description: "Perform a swipe gesture",
    inputSchema: {
      type: "object" as const,
      properties: {
        device_id: {
          type: "string",
          description: "Device ID",
        },
        from_x: {
          type: "number",
          description: "Starting X coordinate",
        },
        from_y: {
          type: "number",
          description: "Starting Y coordinate",
        },
        to_x: {
          type: "number",
          description: "Ending X coordinate",
        },
        to_y: {
          type: "number",
          description: "Ending Y coordinate",
        },
        duration_ms: {
          type: "number",
          description: "Duration in milliseconds (default: 300)",
        },
      },
      required: ["device_id", "from_x", "from_y", "to_x", "to_y"],
    },
  },
  {
    name: "go_home",
    description: "Navigate to device home screen",
    inputSchema: {
      type: "object" as const,
      properties: {
        device_id: {
          type: "string",
          description: "Device ID",
        },
      },
      required: ["device_id"],
    },
  },
  {
    name: "launch_app",
    description: "Launch an application by bundle ID",
    inputSchema: {
      type: "object" as const,
      properties: {
        device_id: {
          type: "string",
          description: "Device ID",
        },
        bundle_id: {
          type: "string",
          description: "App bundle ID (e.g., com.apple.Preferences, com.android.settings)",
        },
      },
      required: ["device_id", "bundle_id"],
    },
  },
  {
    name: "list_apps",
    description: "List installed applications on the device",
    inputSchema: {
      type: "object" as const,
      properties: {
        device_id: {
          type: "string",
          description: "Device ID",
        },
      },
      required: ["device_id"],
    },
  },
  {
    name: "get_ocr",
    description: "Perform OCR text recognition on the current screen (iOS only). Returns detected text with screen coordinates for tapping (already adjusted for tapping).",
    inputSchema: {
      type: "object" as const,
      properties: {
        device_id: {
          type: "string",
          description: "Device ID",
        },
      },
      required: ["device_id"],
    },
  },
  {
    name: "execute_dsl",
    description: `Execute a batch of automation steps using the DSL (Domain Specific Language).
This is the PREFERRED method for complex automation as it's more reliable than sequential API calls.

DSL supports: observe, tap, type, toggle, swipe, scroll, open_app, navigate, wait_for, assert_*, if_exists, delay, execute_js (web)

Example DSL script:
{
  "version": "0.2",
  "steps": [
    {"action": "observe", "context": "native", "include": ["ui_tree"]},
    {"action": "tap", "predicate": {"text_contains": "Settings"}},
    {"action": "delay", "duration_ms": 500},
    {"action": "observe", "context": "native", "include": ["ui_tree"]}
  ],
  "on_fail": {"strategy": "retry", "max_retries": 2}
}`,
    inputSchema: {
      type: "object" as const,
      properties: {
        device_id: {
          type: "string",
          description: "Device ID",
        },
        script: {
          type: "object",
          description: "DSL script object with version, steps, and optional on_fail",
          properties: {
            version: {
              type: "string",
              description: "DSL version (use '0.2')",
            },
            steps: {
              type: "array",
              description: "Array of action steps",
              items: { type: "object" },
            },
            on_fail: {
              type: "object",
              description: "Failure handling strategy",
            },
          },
          required: ["version", "steps"],
        },
      },
      required: ["device_id", "script"],
    },
  },
  {
    name: "run_agent",
    description: "Run an AI agent to perform a task autonomously. The agent will observe the screen, make decisions, and execute actions to complete the task.",
    inputSchema: {
      type: "object" as const,
      properties: {
        device_id: {
          type: "string",
          description: "Device ID",
        },
        task: {
          type: "string",
          description: "Task description (e.g., 'Open Settings and enable WiFi')",
        },
        agent_type: {
          type: "string",
          enum: ["toolagent", "hierarchical", "classic"],
          description: "Agent type (default: toolagent)",
        },
        use_vision: {
          type: "boolean",
          description: "Enable vision/screenshots (default: from app settings)",
        },
      },
      required: ["device_id", "task"],
    },
  },
  {
    name: "web_list_pages",
    description: "List available web pages (browser tabs and WebViews) for web automation",
    inputSchema: {
      type: "object" as const,
      properties: {
        device_id: {
          type: "string",
          description: "Device ID",
        },
      },
      required: ["device_id"],
    },
  },
  {
    name: "web_navigate",
    description: "Navigate to a URL in the browser",
    inputSchema: {
      type: "object" as const,
      properties: {
        device_id: {
          type: "string",
          description: "Device ID",
        },
        url: {
          type: "string",
          description: "URL to navigate to",
        },
      },
      required: ["device_id", "url"],
    },
  },
  {
    name: "web_get_dom",
    description: "Get the DOM tree of the current web page",
    inputSchema: {
      type: "object" as const,
      properties: {
        device_id: {
          type: "string",
          description: "Device ID",
        },
      },
      required: ["device_id"],
    },
  },
  {
    name: "web_click",
    description: "Click an element in the web page using CSS selector",
    inputSchema: {
      type: "object" as const,
      properties: {
        device_id: {
          type: "string",
          description: "Device ID",
        },
        selector: {
          type: "string",
          description: "CSS selector (e.g., 'button.submit', '#login-btn')",
        },
      },
      required: ["device_id", "selector"],
    },
  },
  {
    name: "web_type",
    description: "Type text into a web element using CSS selector",
    inputSchema: {
      type: "object" as const,
      properties: {
        device_id: {
          type: "string",
          description: "Device ID",
        },
        selector: {
          type: "string",
          description: "CSS selector for the input element",
        },
        text: {
          type: "string",
          description: "Text to type",
        },
      },
      required: ["device_id", "selector", "text"],
    },
  },
  {
    name: "web_execute_js",
    description: "Execute JavaScript in the web page context",
    inputSchema: {
      type: "object" as const,
      properties: {
        device_id: {
          type: "string",
          description: "Device ID",
        },
        script: {
          type: "string",
          description: "JavaScript code to execute (use 'return' for results)",
        },
      },
      required: ["device_id", "script"],
    },
  },
  {
    name: "http_request",
    description: `Make a raw HTTP request to the MobAI API. Use this for advanced operations not covered by other tools.

Base URL: http://127.0.0.1:8686/api/v1

Common endpoints:
- GET /devices - List devices
- GET /devices/{id}/screenshot - Take screenshot
- GET /devices/{id}/ui-tree - Get UI tree
- POST /devices/{id}/dsl/execute - Execute DSL script
- POST /devices/{id}/agent/run - Run AI agent`,
    inputSchema: {
      type: "object" as const,
      properties: {
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
          description: "HTTP method",
        },
        url: {
          type: "string",
          description: "Full URL or endpoint path (e.g., /devices)",
        },
        body: {
          type: "string",
          description: "Request body as JSON string",
        },
        timeout_ms: {
          type: "number",
          description: "Timeout in milliseconds (default: 600000)",
        },
      },
      required: ["method", "url"],
    },
  },
];

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: { status: number; statusText: string; body: any };

    switch (name) {
      case "list_devices":
        result = await makeRequest("GET", "/devices");
        break;

      case "get_device":
        result = await makeRequest("GET", `/devices/${args?.device_id}`);
        break;

      case "start_bridge":
        result = await makeRequest("POST", `/devices/${args?.device_id}/bridge/start`, null, 60000);
        break;

      case "stop_bridge":
        result = await makeRequest("POST", `/devices/${args?.device_id}/bridge/stop`);
        break;

      case "get_screenshot":
        result = await makeRequest("GET", `/devices/${args?.device_id}/screenshot`);
        break;

      case "get_ui_tree": {
        const params = new URLSearchParams();
        if (args?.verbose) params.set("verbose", "true");
        if (args?.only_visible === false) params.set("onlyVisible", "false");
        if (args?.include_keyboard) params.set("includeKeyboard", "true");
        const queryString = params.toString();
        const endpoint = `/devices/${args?.device_id}/ui-tree${queryString ? `?${queryString}` : ""}`;
        result = await makeRequest("GET", endpoint);
        break;
      }

      case "tap": {
        const body: any = {};
        if (args?.index !== undefined) body.index = args.index;
        if (args?.x !== undefined && args?.y !== undefined) {
          body.x = args.x;
          body.y = args.y;
        }
        result = await makeRequest("POST", `/devices/${args?.device_id}/tap`, body);
        break;
      }

      case "type_text":
        result = await makeRequest("POST", `/devices/${args?.device_id}/type`, { text: args?.text });
        break;

      case "swipe":
        result = await makeRequest("POST", `/devices/${args?.device_id}/swipe`, {
          fromX: args?.from_x,
          fromY: args?.from_y,
          toX: args?.to_x,
          toY: args?.to_y,
          duration: args?.duration_ms ?? 300,
        });
        break;

      case "go_home":
        result = await makeRequest("POST", `/devices/${args?.device_id}/go-home`);
        break;

      case "launch_app":
        result = await makeRequest("POST", `/devices/${args?.device_id}/launch-app`, {
          bundleId: args?.bundle_id,
        });
        break;

      case "list_apps":
        result = await makeRequest("GET", `/devices/${args?.device_id}/apps`);
        break;

      case "get_ocr":
        result = await makeRequest("GET", `/devices/${args?.device_id}/ocr`);
        break;

      case "execute_dsl":
        result = await makeRequest(
          "POST",
          `/devices/${args?.device_id}/dsl/execute`,
          args?.script,
          300000 // 5 minutes
        );
        break;

      case "run_agent": {
        const agentBody: any = { task: args?.task };
        if (args?.agent_type) agentBody.agentType = args.agent_type;
        if (args?.use_vision !== undefined) agentBody.useVision = args.use_vision;
        result = await makeRequest(
          "POST",
          `/devices/${args?.device_id}/agent/run`,
          agentBody,
          600000 // 10 minutes
        );
        break;
      }

      case "web_list_pages":
        result = await makeRequest("GET", `/devices/${args?.device_id}/web/pages`);
        break;

      case "web_navigate":
        result = await makeRequest("POST", `/devices/${args?.device_id}/web/navigate`, {
          url: args?.url,
        });
        break;

      case "web_get_dom":
        result = await makeRequest("GET", `/devices/${args?.device_id}/web/dom`);
        break;

      case "web_click":
        result = await makeRequest("POST", `/devices/${args?.device_id}/web/click`, {
          selector: args?.selector,
        });
        break;

      case "web_type":
        result = await makeRequest("POST", `/devices/${args?.device_id}/web/type`, {
          selector: args?.selector,
          text: args?.text,
        });
        break;

      case "web_execute_js":
        result = await makeRequest("POST", `/devices/${args?.device_id}/web/execute`, {
          script: args?.script,
        });
        break;

      case "http_request": {
        const url = (args?.url as string).startsWith("http")
          ? (args?.url as string)
          : `${API_BASE_URL}${args?.url}`;

        let body: any = undefined;
        if (args?.body) {
          try {
            body = JSON.parse(args.body as string);
          } catch {
            body = args.body;
          }
        }

        result = await makeRequest(
          args?.method as string,
          url,
          body,
          (args?.timeout_ms as number) ?? DEFAULT_TIMEOUT_MS
        );
        break;
      }

      default:
        return {
          content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    const formattedBody =
      typeof result.body === "string"
        ? result.body
        : JSON.stringify(result.body, null, 2);

    return {
      content: [
        {
          type: "text" as const,
          text: `Status: ${result.status} ${result.statusText}\n\n${formattedBody}`,
        },
      ],
      isError: result.status >= 400,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        content: [{ type: "text" as const, text: "Request timed out" }],
        isError: true,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text" as const, text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// Resources
const RESOURCES = [
  {
    uri: "mobai://api-reference",
    name: "MobAI API Reference",
    description: "Complete API documentation for MobAI HTTP API",
    mimeType: "text/markdown",
  },
  {
    uri: "mobai://dsl-guide",
    name: "DSL Automation Guide",
    description: "Guide for using the DSL batch execution system",
    mimeType: "text/markdown",
  },
  {
    uri: "mobai://native-runner",
    name: "Native App Automation",
    description: "Guide for automating native mobile apps",
    mimeType: "text/markdown",
  },
  {
    uri: "mobai://web-runner",
    name: "Web Automation",
    description: "Guide for automating browsers and WebViews",
    mimeType: "text/markdown",
  },
];

// Handle list resources request
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return { resources: RESOURCES };
});

// Handle read resource request
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  const content = getResourceContent(uri);
  if (!content) {
    throw new Error(`Resource not found: ${uri}`);
  }

  return {
    contents: [
      {
        uri,
        mimeType: "text/markdown",
        text: content,
      },
    ],
  };
});

function getResourceContent(uri: string): string | null {
  switch (uri) {
    case "mobai://api-reference":
      return API_REFERENCE;
    case "mobai://dsl-guide":
      return DSL_GUIDE;
    case "mobai://native-runner":
      return NATIVE_RUNNER_GUIDE;
    case "mobai://web-runner":
      return WEB_RUNNER_GUIDE;
    default:
      return null;
  }
}

// Resource content
const API_REFERENCE = `# MobAI API Reference

**Base URL:** \`http://127.0.0.1:8686/api/v1\`

## Device Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| /devices | GET | List all connected devices |
| /devices/{id} | GET | Get device info |
| /devices/{id}/screenshot | GET | Capture screenshot (saved to /tmp/mobai/screenshots/) |
| /devices/{id}/ui-tree | GET | Get UI accessibility tree |
| /devices/{id}/apps | GET | List installed apps |
| /devices/{id}/ocr | GET | OCR text recognition (iOS only) |

## Bridge Control

| Endpoint | Method | Description |
|----------|--------|-------------|
| /devices/{id}/bridge/start | POST | Start on-device bridge (required for automation) |
| /devices/{id}/bridge/stop | POST | Stop bridge |

## UI Operations

| Endpoint | Method | Description |
|----------|--------|-------------|
| /devices/{id}/tap | POST | Tap element: {"index": N} or {"x": X, "y": Y} |
| /devices/{id}/swipe | POST | Swipe: {"fromX", "fromY", "toX", "toY", "duration"} |
| /devices/{id}/type | POST | Type text: {"text": "..."} |
| /devices/{id}/go-home | POST | Go to home screen |
| /devices/{id}/launch-app | POST | Launch app: {"bundleId": "..."} |

## DSL Execution

| Endpoint | Method | Description |
|----------|--------|-------------|
| /devices/{id}/dsl/execute | POST | Execute DSL batch script |

## AI Agent

| Endpoint | Method | Description |
|----------|--------|-------------|
| /devices/{id}/agent/run | POST | Run AI agent: {"task": "..."} |

## Performance Metrics

| Endpoint | Method | Description |
|----------|--------|-------------|
| /devices/{id}/metrics/start | POST | Start metrics collection |
| /devices/{id}/metrics/stop | POST | Stop collection, return summary |
| /devices/{id}/metrics | GET | Get raw metrics buffer |
| /devices/{id}/metrics/summary | GET | Get current summary without stopping |

## Web Automation

| Endpoint | Method | Description |
|----------|--------|-------------|
| /devices/{id}/web/pages | GET | List browser tabs/WebViews |
| /devices/{id}/web/navigate | POST | Navigate to URL: {"url": "..."} |
| /devices/{id}/web/dom | GET | Get DOM tree |
| /devices/{id}/web/click | POST | Click element: {"selector": "..."} |
| /devices/{id}/web/type | POST | Type text: {"selector": "...", "text": "..."} |
| /devices/{id}/web/execute | POST | Execute JS: {"script": "..."} |

## Response Format

**Success:**
\`\`\`json
{"success": true, "data": {...}}
\`\`\`

**Error:**
\`\`\`json
{"error": "message", "code": "ERROR_CODE"}
\`\`\`

## DSL Action Reference

### type Action
- **predicate**: Required if keyboard not already open (auto-taps the element first)
- **dismiss_keyboard**: Default \`false\` (keyboard stays open after typing)
- **clear_first**: Optional, clears field before typing

\`\`\`json
{"action": "type", "text": "hello", "predicate": {"type": "input"}}
\`\`\`

### press_key Action
- **key**: Keyboard key to press (return, tab, delete, escape, etc.)
- **context**: Optional, "web" for web context (supports enter, tab, delete, escape)

\`\`\`json
{"action": "press_key", "key": "return"}
{"action": "press_key", "key": "tab", "context": "web"}
\`\`\`

### select_web_context Action
- **url_contains**: Filter by URL substring
- **title_contains**: Filter by page title substring

\`\`\`json
{"action": "select_web_context"}
{"action": "select_web_context", "url_contains": "example.com"}
{"action": "select_web_context", "title_contains": "Login"}
\`\`\`
`;

const DSL_GUIDE = `# MobAI DSL Guide

The DSL (Domain Specific Language) enables batch execution of multiple automation steps in a single request.

## Basic Structure

\`\`\`json
{
  "version": "0.2",
  "steps": [
    {"action": "observe", "context": "native", "include": ["ui_tree"]},
    {"action": "tap", "predicate": {"text_contains": "Settings"}}
  ],
  "on_fail": {"strategy": "retry", "max_retries": 2}
}
\`\`\`

## Available Actions

| Action | Description | Key Fields |
|--------|-------------|------------|
| observe | Get UI tree/screenshot/OCR | context, include (ui_tree, screenshot, installed_apps, ocr) |
| tap | Tap element | predicate or coords |
| type | Type text | text, predicate (if keyboard not open), dismiss_keyboard (default: false) |
| press_key | Press keyboard key | key (return, tab, delete, etc.), context (optional: "web") |
| toggle | Set switch state | predicate, state ("on"/"off") |
| swipe | Swipe gesture | direction, distance, duration_ms |
| scroll | Scroll in container | direction, predicate (container), to_element |
| open_app | Launch app | bundle_id |
| navigate | Go home/back | target ("home", "back") |
| wait_for | Wait for element | predicate, timeout_ms |
| assert_exists | Verify element exists | predicate, timeout_ms |
| assert_not_exists | Verify element gone | predicate |
| delay | Wait fixed time | duration_ms |
| if_exists | Conditional | predicate, then, else |
| select_web_context | Select browser/WebView | url_contains, title_contains (optional filters) |
| metrics_start | Start performance monitoring | types, bundle_id, label, thresholds, capture_logs |
| metrics_stop | Stop monitoring, get summary | format ("summary" or "detailed") |

## Predicates

Match elements by:
- \`text\`: Exact text match
- \`text_contains\`: Contains substring (case-insensitive)
- \`text_starts_with\`: Starts with prefix
- \`text_regex\`: Regex pattern
- \`type\`: Element type (button, input, switch, etc.)
- \`label\`: Accessibility label
- \`bounds_hint\`: Screen region (top_half, bottom_half, center, etc.)
- \`near\`: Near another element
- \`index\`: Select Nth match

## Examples

### Tap Element
\`\`\`json
{"action": "tap", "predicate": {"text_contains": "Settings"}}
\`\`\`

### Type Text
\`\`\`json
{"action": "type", "text": "Hello", "predicate": {"type": "input"}}
\`\`\`

Note: \`predicate\` is required if keyboard is not already open. Use \`dismiss_keyboard: true\` to close keyboard after typing.

### Toggle Switch
\`\`\`json
{"action": "toggle", "predicate": {"type": "switch", "text_contains": "WiFi"}, "state": "on"}
\`\`\`

### Scroll Until Found
\`\`\`json
{"action": "scroll", "direction": "down", "to_element": {"predicate": {"text": "Privacy"}}, "max_scrolls": 10}
\`\`\`

### Conditional (Dismiss Popup)
\`\`\`json
{
  "action": "if_exists",
  "predicate": {"text_contains": "Allow"},
  "then": [{"action": "tap", "predicate": {"text": "Allow"}}]
}
\`\`\`

## Failure Strategies

- \`abort\`: Stop on failure (default)
- \`skip\`: Skip failed step, continue
- \`retry\`: Retry with delay

## OCR (iOS only)

Use \`include: ["ocr"]\` in observe to get text recognition when UI tree is empty:

\`\`\`json
{"action": "observe", "context": "native", "include": ["ocr"]}
\`\`\`

Returns text with coordinates for tapping (already adjusted for tapping).

## Performance Metrics

Collect CPU, memory, FPS, network, and battery metrics during test flows with optional logging capture.

### Start Metrics Collection
\`\`\`json
{
  "action": "metrics_start",
  "types": ["system_cpu", "system_memory", "fps"],
  "bundle_id": "com.example.app",
  "label": "login_flow",
  "capture_logs": true,
  "thresholds": {
    "cpu_high": 80,
    "fps_low": 45,
    "memory_growth_mb_min": 50
  }
}
\`\`\`

**Fields:**
- \`types\`: Metrics to collect - system_cpu, system_memory, fps, network, battery, process
- \`bundle_id\`: Filter to specific app (optional)
- \`label\`: Human-readable session label (optional)
- \`thresholds\`: Custom thresholds for anomaly detection (optional)
- \`capture_logs\`: Capture device logs during session (default: false)

### Stop and Get Summary
\`\`\`json
{"action": "metrics_stop", "format": "summary"}
\`\`\`

**Response:**
\`\`\`json
{
  "metrics_summary": {
    "session": {
      "label": "login_flow",
      "duration_seconds": 45.2,
      "sample_count": 45,
      "session_id": "abc123",
      "data_file": "/tmp/mobai/metrics/abc123.jsonl",
      "logs_file": "/tmp/mobai/logs/abc123.jsonl",
      "logs_available": true
    },
    "overall_health": "warning",
    "health_score": 72,
    "system_cpu": {"avg": 34.5, "max": 89.2, "p95": 78.1, "status": "ok"},
    "system_memory": {"avg_percent": 45.2, "growth_mb": 28.5, "trend": "increasing", "status": "warning"},
    "fps": {"avg": 58.2, "min": 24.0, "jank_percent": 8.5, "status": "warning"},
    "anomalies": {
      "cpu_spikes": [
        {"at_s": 0.5, "peak": 288, "duration_ms": 18147, "source": "system"}   
      ],
      "fps_drops": [
        {"start_s": 1.2, "end_s": 16.8, "min_fps": 39.5, "avg_fps": 42.3, "samples": 1}
      ],
    },
    "recommendations": [
      "FPS dropped to 24 at +15s - investigate screen transition"
    ]
  }
}
\`\`\`

### Example: Performance Test Flow
\`\`\`json
{
  "version": "0.2",
  "steps": [
    {"action": "metrics_start", "types": ["system_cpu", "system_memory", "fps"], "label": "app_launch"},
    {"action": "open_app", "bundle_id": "com.example.app"},
    {"action": "wait_for", "predicate": {"text": "Welcome"}, "timeout_ms": 10000},
    {"action": "tap", "predicate": {"text": "Login"}},
    {"action": "delay", "duration_ms": 5000},
    {"action": "metrics_stop", "format": "summary"}
  ]
}
\`\`\`
`;

const NATIVE_RUNNER_GUIDE = `# Native App Automation Guide

Use this for automating native mobile apps (Settings, Mail, Instagram, etc.).

## Script Writing Guidelines

The DSL's purpose is to **minimize LLM calls** by encoding assumptions into comprehensive scripts. Write scripts that handle common scenarios without needing to re-observe.

### Example: Handle Cookie Banner
\`\`\`json
{
  "action": "if_exists",
  "predicate": {"text_contains": "Accept Cookies"},
  "then": [{"action": "tap", "predicate": {"text_contains": "Accept"}}]
}
\`\`\`

### Common Knowledge (use without observing)
- Safari has an address bar at the top
- Settings app has Wi-Fi, Bluetooth, General sections
- Alert dialogs have "OK", "Cancel", "Allow", "Don't Allow" buttons
- iOS keyboard has "Done", "Return", "Search" keys

### Script Writing Rules
- **Use open_app** - Always start scripts with open_app to ensure correct app
- **UI tree provided upfront** - You receive the initial UI tree, use it to plan the script
- **Use if_exists for popups** - Handle cookie banners, permission dialogs, notifications
- **observe only for assert_screen_changed** - Use observe to establish baseline, then assert_screen_changed to verify navigation

## IMPORTANT: Browser Native UI

When automating browsers (Safari, Chrome), use **Native Runner** for the browser's own UI:
- Address bar / URL bar
- Tab bar and tab management
- Navigation buttons (back, forward, refresh)
- Bookmarks bar
- Browser menus and settings

These are native OS elements, NOT web content. Only use Web Runner for the actual webpage content inside the browser.

## Workflow

1. **Observe UI** - Get the accessibility tree
2. **Match Elements** - Use predicates to find elements
3. **Execute Actions** - Tap, type, swipe, press_key, etc.
4. **Verify Results** - Check UI state changed

## Type Action

The \`type\` action requires either:
1. Keyboard already open (from previous tap on input), OR
2. A predicate to identify and tap the input field

**dismiss_keyboard** default is \`false\` (keyboard stays open after typing).

### Pattern 1: Tap then Type
\`\`\`json
[
  {"action": "tap", "predicate": {"type": "input"}},
  {"action": "type", "text": "username"},
  {"action": "press_key", "key": "tab"}
]
\`\`\`

### Pattern 2: Type with Predicate
\`\`\`json
{"action": "type", "text": "username", "predicate": {"type": "input", "label": "Username"}}
\`\`\`

### Dismissing Keyboard
- Use \`press_key: return\` to submit and close the keyboard
- If submit is not desired, look for a "Close", "Cancel", "Done" or "Back" button in the UI tree and tap it
- On Android, \`press_key: back\` also dismisses the keyboard

## Common Patterns

### Open App and Navigate
\`\`\`json
{
  "version": "0.2",
  "steps": [
    {"action": "open_app", "bundle_id": "com.apple.Preferences"},
    {"action": "delay", "duration_ms": 1000},
    {"action": "observe", "context": "native", "include": ["ui_tree"]},
    {"action": "tap", "predicate": {"text_contains": "General"}}
  ]
}
\`\`\`

### Fill Form
\`\`\`json
{
  "version": "0.2",
  "steps": [
    {"action": "tap", "predicate": {"type": "input"}},
    {"action": "type", "text": "username"},
    {"action": "press_key", "key": "tab"},
    {"action": "type", "text": "password"},
    {"action": "press_key", "key": "return"}
  ]
}
\`\`\`

### Scroll to Find Element
\`\`\`json
{
  "version": "0.2",
  "steps": [
    {"action": "scroll", "direction": "down", "to_element": {"predicate": {"text": "Privacy"}}, "max_scrolls": 10},
    {"action": "tap", "predicate": {"text": "Privacy"}}
  ]
}
\`\`\`

### Handle Dialogs
\`\`\`json
{
  "version": "0.2",
  "steps": [
    {
      "action": "if_exists",
      "predicate": {"text_contains": "Allow"},
      "then": [{"action": "tap", "predicate": {"text": "Allow"}}]
    }
  ]
}
\`\`\`

## Quick Reference

| Action | Description | Key Fields |
|--------|-------------|------------|
| tap | Tap element | predicate or coords |
| type | Type text | text, predicate (if keyboard not open), dismiss_keyboard (default: false) |
| press_key | Press keyboard key | key (return, tab, delete, etc.) |
| swipe | Swipe gesture | direction, distance |
| scroll | Scroll container | direction, to_element |

## Tips

- **Always observe first** - Get UI tree before interacting
- **Use predicates** - More robust than hardcoded indices
- **Add delays after navigation** - Apps need time to render
- **Use retry strategy** - Transient failures are common
- **Use press_key for form navigation** - Tab between fields, Return to submit
- **Use OCR for system dialogs (iOS)** - When UI tree is empty, use \`include: ["ocr"]\`
`;

const WEB_RUNNER_GUIDE = `# Web Automation Guide

**Try native-runner first for simple taps/types.** Only use Web Runner when you need DOM manipulation, CSS selectors, or JavaScript execution.

## iOS Simulator Limitation

**IMPORTANT: Web context is NOT supported on iOS simulators.** Web automation features (select_web_context, web DOM access, CSS selectors, JavaScript execution) only work on:
- **Physical iOS devices** (iPhone, iPad)
- **Android emulators and physical devices**

## When to Use Web Runner

**USE Web Runner for:**
- Native runner returns NO_MATCH for web elements
- CSS selector-based element targeting
- JavaScript execution in page context
- DOM manipulation and inspection
- Complex form interactions requiring DOM access

**DO NOT use Web Runner for:**
- Browser address bar / URL bar → use Native Runner
- Browser tab bar → use Native Runner
- Browser navigation buttons (back, forward, refresh) → use Native Runner
- Browser menus and settings → use Native Runner
- Any UI outside the webpage or webview content area → use Native Runner

The browser's own UI (address bar, tabs, navigation) are **native OS elements**, not web content.

## Platform Support

| Platform | Browser | Protocol |
|----------|---------|----------|
| iOS | Safari, WebViews | WebInspector |
| Android | Chrome, WebViews | Chrome DevTools Protocol |

## Workflow

1. **Select web context** - Connect to browser
2. **Navigate** - Go to URL
3. **Get DOM** - Inspect page structure
4. **Interact** - Click, type, press_key using CSS selectors

## select_web_context Options

\`\`\`json
{"action": "select_web_context"}
{"action": "select_web_context", "url_contains": "example.com"}
{"action": "select_web_context", "title_contains": "Login"}
\`\`\`

Use \`url_contains\` or \`title_contains\` to select a specific tab/WebView when multiple are available.

## press_key (Web Context)

Press keyboard keys in web context. Supported keys: \`enter\`, \`tab\`, \`delete\`, \`escape\`

\`\`\`json
{"action": "press_key", "context": "web", "key": "enter"}
{"action": "press_key", "context": "web", "key": "tab"}
\`\`\`

## Common Patterns

### Navigate and Fill Form
\`\`\`json
{
  "version": "0.2",
  "steps": [
    {"action": "select_web_context"},
    {"action": "navigate", "url": "https://example.com/login"},
    {"action": "wait_for", "context": "web", "predicate": {"css_selector": "form"}, "timeout_ms": 5000},
    {"action": "type", "context": "web", "predicate": {"css_selector": "input[name='email']"}, "text": "user@example.com"},
    {"action": "type", "context": "web", "predicate": {"css_selector": "input[type='password']"}, "text": "password"},
    {"action": "tap", "context": "web", "predicate": {"css_selector": "button[type='submit']"}}
  ]
}
\`\`\`

### Click Element
\`\`\`json
{"action": "tap", "context": "web", "predicate": {"css_selector": "button.submit"}}
\`\`\`

### Execute JavaScript
\`\`\`json
{"action": "execute_js", "script": "return document.querySelector('h1').textContent"}
\`\`\`

## CSS Selectors

| Selector | Description |
|----------|-------------|
| #id | Element by ID |
| .class | Elements by class |
| button.submit | Button with class |
| input[type='email'] | Input by attribute |
| input[name='username'] | Input by name |
| a[href*='login'] | Link containing text in href |

## Tips

- **Select context first** - Use select_web_context before web operations
- **Use specific selectors** - Prefer id > name > class
- **Re-fetch DOM after navigation** - Page content changes
- **Use JavaScript for complex logic** - When CSS selectors aren't enough
`;

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
