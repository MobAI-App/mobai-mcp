#!/usr/bin/env node
/**
 * MobAI MCP Server (stdio)
 *
 * Mirrors the Go HTTP-based MCP server as a stdio transport.
 * Proxies tool calls to the MobAI HTTP API at 127.0.0.1:8686.
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
import * as os from "os";
import * as path from "path";
import { RESOURCES, getResourceContent } from "./resources.js";

const API_BASE_URL = "http://127.0.0.1:8686/api/v1";
const DEFAULT_TIMEOUT_MS = 300000; // 5 minutes (matches Go httpClient timeout)
const SCREENSHOT_DIR = path.join(os.tmpdir(), "mobai", "screenshots");

// ---------------------------------------------------------------------------
// Screenshot helpers
// ---------------------------------------------------------------------------

function ensureScreenshotDir(): void {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
}

function saveBase64ToTemp(base64Data: string, prefix: string): string | null {
  if (!base64Data || base64Data.length <= 200) return null;
  ensureScreenshotDir();
  const filename = `${prefix}_${Date.now()}.png`;
  const filePath = path.join(SCREENSHOT_DIR, filename);
  fs.writeFileSync(filePath, Buffer.from(base64Data, "base64"));
  return filePath;
}

function screenshotToFile(body: any): string {
  if (body?.path) {
    return `Screenshot saved to ${body.path}`;
  }
  // Fallback: base64 mode
  if (body?.data) {
    const imgData = Buffer.from(body.data, "base64");
    ensureScreenshotDir();
    const ext = body.format || "png";
    const filename = `screenshot_${Date.now()}.${ext}`;
    const filePath = path.join(SCREENSHOT_DIR, filename);
    fs.writeFileSync(filePath, imgData);
    return `Screenshot saved to ${filePath}`;
  }
  return JSON.stringify(body, null, 2);
}

function extractDSLScreenshots(body: any): any {
  if (!body?.step_results) return body;

  for (const step of body.step_results) {
    const native = step.result?.observations?.native;
    if (native?.screenshot && typeof native.screenshot === "string" && native.screenshot.length > 200) {
      const filePath = saveBase64ToTemp(native.screenshot, "observe");
      if (filePath) {
        native.screenshot = filePath;
        native.screenshot_saved = true;
      }
    }

    if (step.debug?.screenshot && typeof step.debug.screenshot === "string" && step.debug.screenshot.length > 200) {
      const filePath = saveBase64ToTemp(step.debug.screenshot, "debug");
      if (filePath) {
        step.debug.screenshot = filePath;
        step.debug.screenshot_saved = true;
      }
    }
  }
  return body;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function doRequest(
  method: string,
  urlPath: string,
  payload?: any,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<any> {
  const url = urlPath.startsWith("http") ? urlPath : `${API_BASE_URL}${urlPath}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const opts: RequestInit = {
      method,
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    };
    if (payload !== undefined && ["POST", "PUT", "PATCH"].includes(method)) {
      opts.body = typeof payload === "string" ? payload : JSON.stringify(payload);
    }
    const response = await fetch(url, opts);
    clearTimeout(timeoutId);
    const text = await response.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    if (response.status >= 400) {
      throw new Error(`HTTP ${response.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
    }
    return body;
  } finally {
    clearTimeout(timeoutId);
  }
}

const doGet = (p: string) => doRequest("GET", p);
const doPost = (p: string, body?: any) => doRequest("POST", p, body);
const doDelete = (p: string) => doRequest("DELETE", p);

function textResult(data: any) {
  return {
    content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
  };
}

function errResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new Server(
  { name: "mobai", version: "1.0.0" },
  {
    capabilities: { tools: {}, resources: {} },
    instructions: `MobAI controls Android and iOS devices. Before starting any device task, read the relevant MCP resources:
- mobai://reference/device-automation — how to control devices (read before ANY device interaction)
- mobai://reference/testing — .mob script syntax (read ONLY when user asks to create or fix test scripts)
Check available skills in current work directory and load any relevant to the user's request.`,
  }
);

// ---------------------------------------------------------------------------
// Tool definitions — exactly matches Go registerTools()
// ---------------------------------------------------------------------------

const TOOLS = [
  // Device management
  {
    name: "list_devices",
    description: "List all connected Android and iOS devices",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_device",
    description: "Get details about a specific device",
    inputSchema: {
      type: "object" as const,
      properties: { device_id: { type: "string", description: "Device ID" } },
      required: ["device_id"],
    },
  },
  {
    name: "start_bridge",
    description: "Start the automation bridge on a device. Required before interacting with the device.",
    inputSchema: {
      type: "object" as const,
      properties: { device_id: { type: "string", description: "Device ID" } },
      required: ["device_id"],
    },
  },
  {
    name: "stop_bridge",
    description: "Stop the automation bridge on a device",
    inputSchema: {
      type: "object" as const,
      properties: { device_id: { type: "string", description: "Device ID" } },
      required: ["device_id"],
    },
  },
  // Screenshot
  {
    name: "get_screenshot",
    description:
      "Capture a fast, low-quality screenshot for LLM visual analysis. Returns the file path to the saved image. The image may be downscaled by an integer factor so its long edge stays ≤ 2000px; when that happens the response includes a scale factor — multiply any coordinates you read off the image by that factor before using them in device actions (tap, swipe, drag, long-press, etc.). UI tree coordinates are already in device pixels, do not scale those. Use this for AI/LLM processing only — for full-quality screenshots use save_screenshot instead.",
    inputSchema: {
      type: "object" as const,
      properties: { device_id: { type: "string", description: "Device ID" } },
      required: ["device_id"],
    },
  },
  {
    name: "save_screenshot",
    description:
      "Save a full-quality PNG screenshot to disk. Use this when you need a high-quality image for reporting, debugging, or sharing — not for LLM processing (use get_screenshot instead).",
    inputSchema: {
      type: "object" as const,
      properties: {
        device_id: { type: "string", description: "Device ID" },
        path: { type: "string", description: "Directory to save screenshot to (supports ~/). Defaults to OS temp directory." },
        name: { type: "string", description: "Optional filename (without .png extension)" },
      },
      required: ["device_id"],
    },
  },
  // Debug launch
  {
    name: "debug_app",
    description:
      "Launch an app in debug mode and write logs to a file. Returns the log file path — use Read/Grep to inspect logs. Use kill_app to stop.",
    inputSchema: {
      type: "object" as const,
      properties: {
        device_id: { type: "string", description: "Device ID" },
        bundle_id: { type: "string", description: "Bundle ID of the app to debug" },
        log_path: { type: "string", description: "Directory for log file (supports ~/). Defaults to OS temp directory." },
      },
      required: ["device_id", "bundle_id"],
    },
  },
  // App management
  {
    name: "list_apps",
    description: "List installed apps on the device",
    inputSchema: {
      type: "object" as const,
      properties: { device_id: { type: "string", description: "Device ID" } },
      required: ["device_id"],
    },
  },
  {
    name: "install_app",
    description: "Install an app on the device from a local file path (.apk for Android, .ipa for iOS)",
    inputSchema: {
      type: "object" as const,
      properties: {
        device_id: { type: "string", description: "Device ID" },
        path: { type: "string", description: "Local file path to the app (.apk or .ipa)" },
      },
      required: ["device_id", "path"],
    },
  },
  {
    name: "uninstall_app",
    description: "Uninstall an app from the device",
    inputSchema: {
      type: "object" as const,
      properties: {
        device_id: { type: "string", description: "Device ID" },
        bundle_id: { type: "string", description: "App bundle ID (iOS) or package name (Android)" },
      },
      required: ["device_id", "bundle_id"],
    },
  },
  // DSL execution
  {
    name: "execute_dsl",
    description: `Execute a batch of DSL commands on a device. This is the primary tool for all device interaction — tap, type, swipe, observe, launch apps, assertions, web automation, and more.

You MUST read the MCP resource mobai://reference/device-automation to learn how to control devices before using this tool.

Input: JSON string with "version": "0.2" and "steps" array. Example:
{"version":"0.2","steps":[
  {"action":"open_app","bundle_id":"com.apple.Preferences"},
  {"action":"tap","predicate":{"text_contains":"Wi-Fi"}},
  {"action":"wait_for","predicate":{"type":"switch"},"timeout_ms":3000}
]}`,
    inputSchema: {
      type: "object" as const,
      properties: {
        device_id: { type: "string", description: "Device ID" },
        commands: { type: "string", description: "DSL script as JSON string with version and steps" },
      },
      required: ["device_id", "commands"],
    },
  },
  // Test management
  {
    name: "test_get_active",
    description:
      "Get the currently active test project directory and its .mob test cases. Use this to discover the project path and available tests. The agent can then read/write/create/delete .mob files directly in the returned directory.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "test_list_projects",
    description: "List all known test project directories with their .mob test cases. Each project is a directory containing .mob script files.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "test_run",
    description: "Run a .mob test case on a device. The case_path is relative to the project directory.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_dir: { type: "string", description: "Absolute path to the project directory" },
        case_path: { type: "string", description: "Relative path to the .mob file within the project, e.g. auth/login.mob" },
        device_id: { type: "string", description: "Device ID to run the test on" },
      },
      required: ["project_dir", "case_path", "device_id"],
    },
  },
];

// ---------------------------------------------------------------------------
// List tools
// ---------------------------------------------------------------------------

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// ---------------------------------------------------------------------------
// Tool call handler
// ---------------------------------------------------------------------------

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // Device management
      case "list_devices":
        return textResult(await doGet("/devices"));

      case "get_device":
        return textResult(await doGet(`/devices/${args?.device_id}`));

      case "start_bridge":
        return textResult(await doPost(`/devices/${args?.device_id}/bridge/start`));

      case "stop_bridge":
        return textResult(await doPost(`/devices/${args?.device_id}/bridge/stop`));

      // Screenshots
      case "get_screenshot": {
        const body = await doGet(`/devices/${args?.device_id}/screenshot?low_quality=true`);
        return textResult(screenshotToFile(body));
      }

      case "save_screenshot": {
        const params = new URLSearchParams();
        if (args?.path) params.set("path", args.path as string);
        if (args?.name) params.set("name", args.name as string);
        const query = params.toString();
        const body = await doGet(`/devices/${args?.device_id}/screenshot${query ? "?" + query : ""}`);
        return textResult(screenshotToFile(body));
      }

      // App management
      case "debug_app": {
        const body: any = { bundleId: args?.bundle_id };
        if (args?.log_path) body.logPath = args.log_path;
        return textResult(await doPost(`/devices/${args?.device_id}/debug/launch`, body));
      }

      case "list_apps":
        return textResult(await doGet(`/devices/${args?.device_id}/apps`));

      case "install_app":
        return textResult(await doPost(`/devices/${args?.device_id}/install-app`, { path: args?.path }));

      case "uninstall_app":
        return textResult(await doDelete(`/devices/${args?.device_id}/apps/${encodeURIComponent(args?.bundle_id as string)}`));

      // DSL execution
      case "execute_dsl": {
        const commandsStr = args?.commands as string;
        if (!commandsStr) throw new Error("commands is required");
        let script: any;
        try {
          script = JSON.parse(commandsStr);
        } catch {
          throw new Error("invalid DSL JSON: " + commandsStr);
        }
        const body = await doPost(`/devices/${args?.device_id}/dsl/execute`, script);
        return textResult(extractDSLScreenshots(body));
      }

      // Test management
      case "test_get_active":
        return textResult(await doGet("/tests/active"));

      case "test_list_projects":
        return textResult(await doGet("/tests/projects"));

      case "test_run":
        return textResult(await doPost("/tests/cases/run", {
          project_dir: args?.project_dir,
          case_path: args?.case_path,
          device_id: args?.device_id,
        }));

      default:
        return { content: [{ type: "text" as const, text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return errResult("Request timed out");
    }
    return errResult(error);
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
