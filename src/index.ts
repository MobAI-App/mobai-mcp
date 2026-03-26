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
const doPut = (p: string, body?: any) => doRequest("PUT", p, body);
const doPatch = (p: string, body?: any) => doRequest("PATCH", p, body);

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
- mobai://reference/device-automation — how to control devices
- mobai://reference/testing — testing workflow, rules, and .mob script syntax
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
      "Capture a fast, low-quality screenshot for LLM visual analysis. Returns the file path to the saved image. Use this for AI/LLM processing only — for full-quality screenshots use save_screenshot instead.",
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

Read the MCP resource mobai://reference/device-automation to learn how to control devices before using this tool.

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
    description: "Get the currently active test project and its cases. Use this to discover which test cases are available.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "test_list_projects",
    description: "List all test projects with their test cases included inline",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "test_create_project",
    description: "Create a new test project",
    inputSchema: {
      type: "object" as const,
      properties: { name: { type: "string", description: "Project name" } },
      required: ["name"],
    },
  },
  {
    name: "test_rename_project",
    description: "Rename an existing test project",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Project ID" },
        name: { type: "string", description: "New project name" },
      },
      required: ["project_id", "name"],
    },
  },
  {
    name: "test_create_case",
    description: "Create a new test case in a project",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Project ID" },
        name: { type: "string", description: "Test case name" },
        folder: { type: "string", description: "Optional folder path within the project" },
      },
      required: ["project_id", "name"],
    },
  },
  {
    name: "test_rename_case",
    description: "Rename an existing test case",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Project ID" },
        case_id: { type: "string", description: "Test case ID" },
        name: { type: "string", description: "New test case name" },
      },
      required: ["project_id", "case_id", "name"],
    },
  },
  {
    name: "test_delete_case",
    description: "Delete a test case from a project",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Project ID" },
        case_id: { type: "string", description: "Test case ID" },
      },
      required: ["project_id", "case_id"],
    },
  },
  {
    name: "test_get_script",
    description: "Get the .mob script content for a test case (with 1-based line numbers)",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Project ID" },
        case_id: { type: "string", description: "Test case ID" },
      },
      required: ["project_id", "case_id"],
    },
  },
  {
    name: "test_replace_script",
    description: "Replace the entire .mob script for a test case",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Project ID" },
        case_id: { type: "string", description: "Test case ID" },
        script: { type: "string", description: "New script content (without line numbers)" },
      },
      required: ["project_id", "case_id", "script"],
    },
  },
  {
    name: "test_update_line",
    description: "Update a single line in the .mob script",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Project ID" },
        case_id: { type: "string", description: "Test case ID" },
        line_number: { type: "number", description: "1-based line number to update" },
        content: { type: "string", description: "New line content" },
      },
      required: ["project_id", "case_id", "line_number", "content"],
    },
  },
  {
    name: "test_insert_after",
    description: "Insert a new line after the specified line number in the .mob script",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Project ID" },
        case_id: { type: "string", description: "Test case ID" },
        line_number: { type: "number", description: "1-based line number to insert after (0 = insert at beginning)" },
        content: { type: "string", description: "Line content to insert" },
      },
      required: ["project_id", "case_id", "line_number", "content"],
    },
  },
  {
    name: "test_delete_line",
    description: "Delete a line from the .mob script",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Project ID" },
        case_id: { type: "string", description: "Test case ID" },
        line_number: { type: "number", description: "1-based line number to delete" },
      },
      required: ["project_id", "case_id", "line_number"],
    },
  },
  {
    name: "test_run",
    description: "Run a test case on a device",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Project ID" },
        case_id: { type: "string", description: "Test case ID" },
        device_id: { type: "string", description: "Device ID to run the test on" },
      },
      required: ["project_id", "case_id", "device_id"],
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

function testCasePath(args: any): string {
  const projectId = args?.project_id;
  const caseId = args?.case_id;
  if (!projectId || !caseId) throw new Error("project_id and case_id are required");
  return `/tests/projects/${projectId}/cases/${caseId}`;
}

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

      case "test_create_project":
        return textResult(await doPost("/tests/projects", { name: args?.name }));

      case "test_rename_project":
        return textResult(await doPatch(`/tests/projects/${args?.project_id}`, { name: args?.name }));

      case "test_create_case": {
        const body: any = { name: args?.name };
        if (args?.folder) body.folder = args.folder;
        return textResult(await doPost(`/tests/projects/${args?.project_id}/cases`, body));
      }

      case "test_rename_case": {
        const p = testCasePath(args);
        return textResult(await doPatch(p, { name: args?.name }));
      }

      case "test_delete_case": {
        const p = testCasePath(args);
        return textResult(await doDelete(p));
      }

      case "test_get_script": {
        const p = testCasePath(args);
        return textResult(await doGet(`${p}/script`));
      }

      case "test_replace_script": {
        const p = testCasePath(args);
        return textResult(await doPut(`${p}/script`, { script: args?.script }));
      }

      case "test_update_line": {
        const p = testCasePath(args);
        return textResult(await doPost(`${p}/script/update-line`, {
          line_number: args?.line_number,
          content: args?.content,
        }));
      }

      case "test_insert_after": {
        const p = testCasePath(args);
        return textResult(await doPost(`${p}/script/insert-after`, {
          line_number: args?.line_number,
          content: args?.content,
        }));
      }

      case "test_delete_line": {
        const p = testCasePath(args);
        return textResult(await doPost(`${p}/script/delete-line`, {
          line_number: args?.line_number,
        }));
      }

      case "test_run": {
        const p = testCasePath(args);
        return textResult(await doPost(`${p}/run`, { device_id: args?.device_id }));
      }

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
