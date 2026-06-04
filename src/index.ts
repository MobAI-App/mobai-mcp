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
const DOWNLOAD_URL = "https://mobai.run/download";

// Message shown when the MobAI desktop app is not reachable at its local API.
const APP_NOT_RUNNING_MESSAGE =
  `Could not reach the MobAI desktop app at 127.0.0.1:8686. ` +
  `Make sure the MobAI desktop app is installed and running, then try again. ` +
  `If you don't have it yet, download and install it from ${DOWNLOAD_URL}.`;

/**
 * Detects the "connection refused" / "could not connect" family of errors that
 * Node's fetch throws when nothing is listening on the MobAI API port. These
 * surface as a TypeError ("fetch failed") whose `cause` carries an errno code
 * such as ECONNREFUSED / ENOTFOUND / ECONNRESET.
 */
function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const codes = ["ECONNREFUSED", "ENOTFOUND", "ECONNRESET", "EHOSTUNREACH", "ETIMEDOUT"];
  const cause = (err as any).cause;
  const causeCode = cause && typeof cause === "object" ? cause.code : undefined;
  if (typeof causeCode === "string" && codes.includes(causeCode)) return true;
  // Fallback: undici reports a bare "fetch failed" TypeError for these.
  return err.name === "TypeError" && /fetch failed/i.test(err.message);
}

// ---------------------------------------------------------------------------
// Screenshot helpers
// ---------------------------------------------------------------------------

function ensureScreenshotDir(): void {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
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
    let response: Response;
    try {
      response = await fetch(url, opts);
    } catch (err) {
      if (isConnectionError(err)) {
        throw new Error(APP_NOT_RUNNING_MESSAGE);
      }
      throw err;
    }
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
- mobai://reference/debugging — how to attach lldb, set breakpoints, inspect state (read before ANY debug_* tool)
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
    description: "Run a .mob test case on a device. The case_path is relative to the project directory. Pass params to supply values for ${name} substitution in the script.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_dir: { type: "string", description: "Absolute path to the project directory" },
        case_path: { type: "string", description: "Relative path to the .mob file within the project, e.g. auth/login.mob" },
        device_id: { type: "string", description: "Device ID to run the test on" },
        params: { type: "object", additionalProperties: { type: "string" }, description: "Optional key-value parameters for ${name} substitution in the script" },
      },
      required: ["project_dir", "case_path", "device_id"],
    },
  },
  // Live app debugging via lldb-dap. iOS only. Read mobai://reference/debugging
  // before using any of these.
  {
    name: "debug_attach",
    description:
      "Start a debug session for an iOS app. Provide either bundle_id (launches and attaches) or pid (attaches to a running process). Optional breakpoints[] are armed before the target resumes. Read mobai://reference/debugging first.",
    inputSchema: {
      type: "object" as const,
      properties: {
        device_id: { type: "string", description: "Device ID" },
        bundle_id: { type: "string", description: "App bundle ID to launch and attach. Either this or pid is required." },
        pid: { type: "number", description: "Attach to an already-running PID. Either this or bundle_id is required." },
        breakpoints: {
          type: "array",
          items: { type: "string" },
          description: `Initial breakpoint specs. "File.swift:42" (preferred), "Module.Type.method" (no parameter signature), "-[Class method:]", or runtime symbol.`,
        },
        stop_on_entry: { type: "boolean", description: "Simulator only — pause at first instruction." },
      },
      required: ["device_id"],
    },
  },
  {
    name: "debug_state",
    description:
      "Query the current debug session. Returns {state, breakpoints} by default. Set include_stack=true to also fetch the stack of the stopped thread; include_vars=true to also fetch frame[0] locals; include_threads=true to enumerate all threads.",
    inputSchema: {
      type: "object" as const,
      properties: {
        device_id: { type: "string", description: "Device ID" },
        include_stack: { type: "boolean", description: "Include stack of stopped thread." },
        include_vars: { type: "boolean", description: "Include frame[0] locals." },
        include_threads: { type: "boolean", description: "Include all threads." },
      },
      required: ["device_id"],
    },
  },
  {
    name: "debug_breakpoint",
    description:
      "Add or remove a breakpoint in the active debug session. For action=add provide spec; for action=remove provide id.",
    inputSchema: {
      type: "object" as const,
      properties: {
        device_id: { type: "string", description: "Device ID" },
        action: { type: "string", enum: ["add", "remove"], description: `"add" or "remove"` },
        spec: { type: "string", description: `Breakpoint spec for action=add. "File.swift:42", "Module.Type.method", "-[Class method:]", or runtime symbol.` },
        id: { type: "number", description: "Breakpoint id for action=remove." },
      },
      required: ["device_id", "action"],
    },
  },
  {
    name: "debug_eval",
    description:
      `Evaluate a Swift/ObjC expression at the current pause. Session must be paused. Examples: "p defaultPrivate", "po self.viewModel.user.email", "frame variable".`,
    inputSchema: {
      type: "object" as const,
      properties: {
        device_id: { type: "string", description: "Device ID" },
        expression: { type: "string", description: "Expression to evaluate" },
        frame_id: { type: "number", description: "Optional frame id to evaluate in" },
      },
      required: ["device_id", "expression"],
    },
  },
  {
    name: "debug_step",
    description:
      `Advance the target.\n  "in" — step into next call (blocks ~ms, returns {state, breakpoints, stack, frame0_locals})\n  "over" — step over next call (same shape)\n  "out" — run until current frame returns (same shape)\n  "continue" — resume until next breakpoint (fire-and-forget; returns just {state, breakpoints} — poll debug_state for next stop)`,
    inputSchema: {
      type: "object" as const,
      properties: {
        device_id: { type: "string", description: "Device ID" },
        direction: { type: "string", enum: ["in", "over", "out", "continue"], description: `"in" | "over" | "out" | "continue"` },
        include_stack: { type: "boolean", description: `Include the new stack. Default true. Ignored for direction="continue".` },
        include_vars: { type: "boolean", description: `Include the new frame[0] locals. Default true. Ignored for direction="continue".` },
      },
      required: ["device_id", "direction"],
    },
  },
  {
    name: "debug_detach",
    description: "End the debug session. Pass kill=true to terminate the debuggee; otherwise it keeps running.",
    inputSchema: {
      type: "object" as const,
      properties: {
        device_id: { type: "string", description: "Device ID" },
        kill: { type: "boolean", description: "Terminate debuggee on detach." },
      },
      required: ["device_id"],
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
// Resources (reference docs)
// ---------------------------------------------------------------------------

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return { resources: RESOURCES };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  const text = getResourceContent(uri);
  if (text == null) {
    throw new Error(`Unknown resource: ${uri}`);
  }
  return {
    contents: [{ uri, mimeType: "text/plain", text }],
  };
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
        return textResult(body);
      }

      // Test management
      case "test_get_active":
        return textResult(await doGet("/tests/active"));

      case "test_list_projects":
        return textResult(await doGet("/tests/projects"));

      case "test_run": {
        const body: any = {
          project_dir: args?.project_dir,
          case_path: args?.case_path,
          device_id: args?.device_id,
        };
        const rawParams = args?.params;
        if (rawParams && typeof rawParams === "object") {
          const params: Record<string, string> = {};
          for (const [k, v] of Object.entries(rawParams as Record<string, unknown>)) {
            params[k] = String(v);
          }
          body.params = params;
        }
        return textResult(await doPost("/tests/cases/run", body));
      }

      // Debug session
      case "debug_attach": {
        const dev = args?.device_id as string;
        const bundleID = args?.bundle_id as string | undefined;
        const pid = args?.pid as number | undefined;
        if (!bundleID && !pid) throw new Error("either bundle_id or pid is required");
        const body: any = {};
        if (Array.isArray(args?.breakpoints)) body.breakpoints = args!.breakpoints;
        if (args?.stop_on_entry) body.stopOnEntry = true;
        let path: string;
        if (pid && pid > 0) {
          body.pid = pid;
          path = `/devices/${dev}/debug-session/attach-running`;
        } else {
          body.bundleId = bundleID;
          path = `/devices/${dev}/debug-session/attach`;
        }
        return textResult(await doPost(path, body));
      }

      case "debug_detach": {
        const dev = args?.device_id as string;
        const body: any = args?.kill ? { kill: true } : {};
        return textResult(await doRequest("DELETE", `/devices/${dev}/debug-session`, body));
      }

      case "debug_state": {
        const dev = args?.device_id as string;
        const includeStack = args?.include_stack === true;
        const includeVars = args?.include_vars === true;
        const includeThreads = args?.include_threads === true;
        const base = `/devices/${dev}/debug-session`;
        const snap: any = await doGet(base);
        if (snap?.state === "paused") {
          if (includeThreads) {
            const t: any = await doGet(`${base}/threads`);
            snap.threads = t?.threads;
          }
          if (includeStack || includeVars) {
            const stack: any = await doGet(`${base}/stack`);
            if (includeStack) snap.stack = stack?.frames;
            if (includeVars && Array.isArray(stack?.frames) && stack.frames.length > 0) {
              const frameID = stack.frames[0].id;
              const vars: any = await doGet(`${base}/frames/${frameID}/variables`);
              snap.frame0_locals = vars?.scopes;
            }
          }
        }
        return textResult(snap);
      }

      case "debug_breakpoint": {
        const dev = args?.device_id as string;
        const action = args?.action as string;
        if (action === "add") {
          const spec = args?.spec as string;
          if (!spec) throw new Error("spec is required for action=add");
          return textResult(await doPost(`/devices/${dev}/debug-session/breakpoints`, { spec }));
        } else if (action === "remove") {
          const id = args?.id as number;
          if (!id || id <= 0) throw new Error("id is required for action=remove");
          return textResult(await doDelete(`/devices/${dev}/debug-session/breakpoints/${id}`));
        }
        throw new Error(`action must be "add" or "remove"`);
      }

      case "debug_eval": {
        const dev = args?.device_id as string;
        const body: any = { expression: args?.expression };
        if (args?.frame_id) body.frameId = args.frame_id;
        return textResult(await doPost(`/devices/${dev}/debug-session/eval`, body));
      }

      case "debug_step": {
        const dev = args?.device_id as string;
        const direction = args?.direction as string;
        if (!direction) throw new Error(`direction is required ("in" | "over" | "out")`);
        const body: any = { direction };
        if (typeof args?.include_stack === "boolean") body.includeStack = args.include_stack;
        if (typeof args?.include_vars === "boolean") body.includeVars = args.include_vars;
        return textResult(await doPost(`/devices/${dev}/debug-session/step`, body));
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
