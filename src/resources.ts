export const RESOURCES = [
  {
    uri: "mobai://reference/device-automation",
    name: "Device Automation Reference",
    description: "How to control Android and iOS devices — guide, all actions, predicates, and failure strategies",
    mimeType: "text/plain",
  },
  {
    uri: "mobai://reference/testing",
    name: "Testing Reference",
    description: "Testing workflow, rules, error fixes, and .mob script syntax for test generation",
    mimeType: "text/plain",
  },
  {
    uri: "mobai://claude-code-preview",
    name: "Claude Code Preview Setup",
    description: "How to preview a MobAI device's control UI inside Claude Code's preview panel",
    mimeType: "text/plain",
  },
  {
    uri: "mobai://reference/debugging",
    name: "App Debugging Reference",
    description: "How to attach lldb, set breakpoints, inspect stack/variables, evaluate Swift/ObjC expressions — read before any debug_* tool",
    mimeType: "text/plain",
  },
];

export function getResourceContent(uri: string): string | null {
  switch (uri) {
    case "mobai://reference/device-automation":
      return DEVICE_AUTOMATION_REF;
    case "mobai://reference/testing":
      return TESTING_REF;
    case "mobai://claude-code-preview":
      return CLAUDE_CODE_PREVIEW;
    case "mobai://reference/debugging":
      return DEBUGGING_REF;
    default:
      return null;
  }
}

const CLAUDE_CODE_PREVIEW = `<claude-code-preview>
Prerequisite: the MobAI desktop app must be running. It owns the
localhost 8787 web server the preview panel will render.

1. Call list_devices and grab the device's id and controlUrl.

2. Write .claude/launch.json at the project root (or, inside a git
   worktree, at the worktree root):

   {
     "version": "0.0.1",
     "configurations": [{
       "name": "MobAI — <device name>",
       "runtimeExecutable": "sleep",
       "runtimeArgs": ["86400"],
       "port": 8787,
       "url": "<controlUrl>"
     }]
   }

   - runtimeExecutable + runtimeArgs is a no-op lifetime anchor for
     Claude Code's panel; the real server is MobAI.
   - port is the localhost port Claude Code binds the preview to;
     always 8787 for MobAI.
   - url is the device-specific URL (controlUrl from step 1) that the
     panel actually displays.

3. Call the mcp__Claude_Preview__preview_start tool with the "name"
   from the configuration above.
</claude-code-preview>
`;

const DEVICE_AUTOMATION_REF = `<device-automation-reference>

<guide>
  All device interaction goes through DSL scripts via MCP execute_dsl tool or POST /devices/{id}/dsl/execute.

  <script-format>
    {"version": "0.2", "steps": [...actions...], "on_fail": {"strategy": "retry", "max_retries": 2}}
    Every script must include "version": "0.2" and a "steps" array.
    Optional "params": {"name": "default_value"} declares parameters. Callers supply values via the API; \${name} is substituted in step string fields at runtime.
  </script-format>

  <important>
    Always end scripts with these two steps to receive latest UI state:
    {"action": "wait_for", "stable": true, "timeout_ms": 3000}
    {"action": "observe", "include": ["ui_tree"]}
    Adjust timeout_ms (higher after app launches or network requests). Adjust observe "include" to request only what you need: ui_tree, screenshot, ocr, activity, installed_apps.
  </important>

  <scroll-vs-swipe>scroll is semantic (direction = where to look); swipe is physical (direction = finger movement). Prefer scroll with to_element to find off-screen elements.</scroll-vs-swipe>

  <observe-guidance>
    Prefer UI tree and OCR over screenshots — screenshots consume far more context and are slower. Only use screenshots for visual verification (layout, colors, images).
    only_visible: false — use ONLY for data collection from scrollable views (returns ALL elements including off-screen). NEVER when interacting — off-screen elements cannot be tapped.
  </observe-guidance>

  <ocr-fallback>
    iOS only. When UI tree has suspiciously few elements but screen has more content (React Native, Flutter, custom-rendered apps, system dialogs like Sign in with Apple), use observe with "ocr". Returns text with tap coordinates for elements missing from UI tree.
  </ocr-fallback>

  <execution-modes>
    Default (explore mode): only the last observe in a script runs — earlier observes are skipped. This is the right mode for the typical pattern: actions first, then one observe at the end to see the result. If a step fails, the error includes a debug UI tree so you don't need a separate observe.
    Deterministic mode: every observe runs. Use only when you need to capture screen state between actions within a single script (rare — prefer separate execute_dsl calls so you can reason between steps).
  </execution-modes>

  <workflow>Observe screen → plan → act via execute_dsl → verify (end script with wait_for stable + observe) → repeat until done.</workflow>

  <siri-shortcuts>
    iOS only. Before navigating through multiple screens to reach a feature, check if Siri can take you there directly. Many apps register SiriKit intents and App Shortcuts — a single siri action can replace 5-10 tap/scroll/wait steps.
    Use observe with include: installed_apps to check what an app exposes. Common shortcuts: play media, send messages, open specific screens, make payments, start workouts, get directions.
    Examples: "Open my cart in Amazon", "Play my playlist on Spotify", "Show my reservations in Booking", "Search YouTube for cats".
    If Siri asks a follow-up question, dismiss and re-invoke with a more specific prompt that includes the missing detail.
    Always prefer siri over manual UI navigation when the app supports it — it is faster, more reliable, and survives UI redesigns.
  </siri-shortcuts>

  <per-app-skills>
    Before working with a known app, check ~/.claude/skills/ for a skill matching its bundle id or name (e.g. com-instagram-android, uber) and load it — it may already encode selectors, flows, and quirks learned on a prior run.
    When you discover app-specific gotchas that would cost future sessions time — unstable selectors that only work with a specific predicate, hidden taps, flows that need an extra wait_for, React Native / Flutter screens that need OCR, dialogs that hijack input — create or update a skill at ~/.claude/skills/&lt;app-slug&gt;/SKILL.md capturing the finding. Keep each skill short: the specific quirk, the selector/flow that works, and one sentence on why the obvious approach fails. Do not write generic mobile-automation advice there — that belongs in this reference.

    Also save reusable multi-step flows as labeled mobai CLI command sequences inside the same SKILL.md. When you confirm a flow works (login, dismiss onboarding, open-settings-and-toggle-X, checkout), add a section with a heading like "## Flow: login" and a fenced shell code block of "mobai ..." commands in order — one per step. Mark variable inputs with placeholders (&lt;EMAIL&gt;, &lt;OTP_CODE&gt;) so future sessions know what to substitute. On next run, replay the commands (shell them out or translate to execute_dsl) with placeholders substituted — this avoids re-deriving the flow from scratch. Shell commands are saved (not JSON DSL) because the MobAI CLI does not execute DSL JSON blobs, and shell commands stay replayable from either CLI or MCP sessions. If a snippet breaks because the app changed, update it in place.
  </per-app-skills>

  <screenshot-tools>
    get_screenshot — fast low-quality image for LLM visual analysis.
    save_screenshot — full-quality PNG for reporting, debugging, or sharing.
    A screenshot is a single settled frame — it cannot capture motion. Anything transient (animations, transitions, loading spinners; a screen transition is often only ~300ms) will be missed or caught mid-frame. To verify transitional behavior, use record_start/record_stop, which samples continuously and flags suspicious frames.
  </screenshot-tools>

  <infinite-scrolling>To collect data from infinite-scrolling views (feeds, search results), scroll to load a batch first, then observe with only_visible:false to get all loaded items in one go.</infinite-scrolling>

  <troubleshooting>
    Element not visible — use scroll with to_element to find it.
    App launches and page transitions take time — use wait_for or delay.
    Observe before acting on unfamiliar screens.
    NO_MATCH / failed assert_exists: if the element exists off-screen, the error lists it under "candidates" — scroll to bring it into view (off-screen elements cannot be tapped). Empty candidates means it is genuinely absent or not yet rendered.
  </troubleshooting>
</guide>

<common-types>
  <coordinates>{"x": int, "y": int}</coordinates>
  <target-element>{"predicate": Predicate}</target-element>

  <predicate context="native">
    <note>Prefer text_contains or text_regex over text (exact match) — UI text often changes with state, locale, or dynamic content. Exact match breaks easily.</note>
    <field name="text" type="string">Exact match — use only when the full text is short, static, and unique</field>
    <field name="text_contains" type="string">Substring, case-insensitive — preferred for most matching</field>
    <field name="text_starts_with" type="string">Prefix match</field>
    <field name="text_regex" type="string">Regex pattern — use for dynamic text (numbers, dates, counts)</field>
    <field name="value" type="string">Exact match on the element's entered/current value (not its label/placeholder). Use to verify what was typed into a field — text matching sees the placeholder, value sees the content. Shown as content="..." in the UI tree. Secure fields are masked, so only length/non-empty is meaningful.</field>
    <field name="value_contains" type="string">Substring match (case-insensitive) on the entered/current value</field>
    <field name="type" type="string">button, input, switch, text, image, cell, scrollview</field>
    <field name="accessibility_id" type="string">Exact match on the #id shown in UI tree (without the # prefix)</field>
    <field name="enabled" type="bool">Enabled state</field>
    <field name="visible" type="bool">Visible state</field>
    <field name="selected" type="bool">Selected state</field>
    <field name="near" type="NearPredicate">{"text_contains": "Email", "direction": "below|above|left|right|any", "max_distance": 100}</field>
    <field name="bounds_hint" type="string">top_half, bottom_half, left_half, right_half, center</field>
    <field name="parent_of" type="Predicate">Find parent containing child</field>
    <field name="index" type="int">0-based Nth match disambiguator</field>
  </predicate>

  <predicate context="web">
    <field name="css_selector" type="string">CSS selector</field>
    <field name="xpath" type="string">XPath expression</field>
  </predicate>

  <failure-strategy>
    Per-step or script-wide via on_fail.
    abort (default) | skip | retry (+ max_retries, retry_delay_ms, fallback_strategy) | replan | require_user
    <example>{"on_fail": {"strategy": "retry", "max_retries": 3, "retry_delay_ms": 1000, "fallback_strategy": {"strategy": "skip"}}}</example>
  </failure-strategy>
</common-types>

<native-actions>
  Most actions accept predicate and/or coords to target elements. Only unique fields listed.

  <action name="open_app">
    <field name="bundle_id" required="yes"/>
    <field name="fresh" type="bool">Kill the app before launching to ensure a clean start from the home screen. Use when the app may have been left on an arbitrary screen from a previous run.</field>
    <field name="debug" type="bool">ONLY for debug-built apps (e.g. Flutter dev builds, Xcode debug builds) that need a debugger attached to run. Attaches debugserver, streams stdout/stderr to a log file; result has log_path. Do NOT use for release/App Store apps — they launch fine with debug: false.</field>
    <example>{"action": "open_app", "bundle_id": "com.apple.Preferences"}</example>
    <example>{"action": "open_app", "bundle_id": "com.apple.Preferences", "fresh": true}</example>
    <note>If open_app fails or the app disappears immediately after launch, the app has likely crashed. Do NOT retry or try alternative launch methods — start crash investigation instead. Use debug: true (or metrics_start with capture_logs: true) to capture device logs, then diagnose.</note>
  </action>

  <action name="tap">
    <field name="predicate" required="one-of"/>
    <field name="coords" required="one-of"/>
    <example>{"action": "tap", "predicate": {"text_contains": "Settings"}}</example>
  </action>

  <action name="double_tap">
    <example>{"action": "double_tap", "predicate": {"text": "Photo"}}</example>
  </action>

  <action name="two_finger_tap">
    <example>{"action": "two_finger_tap", "predicate": {"text": "Map"}}</example>
  </action>

  <action name="pinch">
    <field name="scale" type="float" default="2.0">Greater than 1.0 zooms in, less than 1.0 zooms out</field>
    <field name="velocity" type="float" default="1.0">Scale change per second</field>
    <example>{"action": "pinch", "predicate": {"text_contains": "Map"}, "scale": 0.5}</example>
  </action>

  <action name="long_press">
    <field name="predicate" required="yes"/>
    <field name="duration_ms" type="int" default="500"/>
    <example>{"action": "long_press", "predicate": {"text": "Item"}, "duration_ms": 1000}</example>
  </action>

  <action name="type">
    <field name="text" required="yes"/>
    <field name="predicate">Optional target element</field>
    <field name="clear_first" type="bool"/>
    <field name="dismiss_keyboard" type="bool" default="false"/>
    <example>{"action": "type", "text": "Hello", "predicate": {"type": "input"}, "clear_first": true}</example>
  </action>

  <action name="clear">
    Clear a field's text without typing. With a predicate, focuses that field first; without one, clears the currently focused field.
    <field name="predicate">Optional target element</field>
    <example>{"action": "clear", "predicate": {"type": "input"}}</example>
  </action>

  <action name="swipe">
    Direction = finger movement. Use direction OR from_coords/to_coords.
    <field name="direction">up, down, left, right</field>
    <field name="distance">short (25%), medium (50%), full (75%)</field>
    <field name="from_coords" type="Coordinates"/>
    <field name="to_coords" type="Coordinates"/>
    <field name="duration_ms" type="int"/>
    <example>{"action": "swipe", "direction": "up", "distance": "medium"}</example>
  </action>

  <action name="scroll">
    Direction = semantic (where to look), not finger movement.
    <field name="direction" required="yes">down (look below), up (look above)</field>
    <field name="to_element" type="TargetElement"/>
    <field name="max_scrolls" type="int" default="10"/>
    <field name="amount">small, page, full</field>
    <example>{"action": "scroll", "direction": "down", "to_element": {"predicate": {"text": "Privacy"}}, "max_scrolls": 10}</example>
    <note>scroll with to_element returns "reached end of scrollable content" if the list ends before the element is found. If it returns "element not found after scrolling" instead, the list has more content — increase max_scrolls or call scroll again to continue searching.</note>
  </action>

  <action name="drag">
    <field name="from" type="TargetElement" required="one-of"/>
    <field name="from_coords" type="Coordinates" required="one-of"/>
    <field name="to_element" type="TargetElement" required="one-of"/>
    <field name="to_coords" type="Coordinates" required="one-of"/>
    <field name="duration_ms" type="int">Drag motion duration (default 500)</field>
    <field name="press_duration_ms" type="int">Hold before moving (for moving app icons, picking up list items)</field>
    <field name="hold_duration_ms" type="int">Hold at destination before release (useful for iOS drop zones that need a dwell)</field>
    <example>{"action": "drag", "from": {"predicate": {"text": "Item"}}, "to_element": {"predicate": {"text": "Trash"}}}</example>
    <example>{"action": "drag", "from": {"predicate": {"text": "App"}}, "to_element": {"predicate": {"text": "Folder"}}, "press_duration_ms": 500, "hold_duration_ms": 200}</example>
  </action>

  <action name="drag_path">
    <field name="points" type="array of {x, y, duration_ms}" required="true">Single-finger drag along a multi-point path. Each point's duration_ms is the time to move to it from the previous point. The first point is the touch-down location and its duration_ms is an optional initial press-hold (omit or 0 for none). Needs at least 2 points; every point after the first must have duration_ms > 0. Use this (not drag) for swipe-path gestures like unlock patterns, freeform draws, or curved scrolls.</field>
    <example>{"action": "drag_path", "points": [{"x": 100, "y": 400}, {"x": 150, "y": 300, "duration_ms": 150}, {"x": 300, "y": 500, "duration_ms": 300}]}</example>
    <example>{"action": "drag_path", "points": [{"x": 100, "y": 400, "duration_ms": 200}, {"x": 300, "y": 400, "duration_ms": 250}]}</example>
  </action>

  <action name="press_key">
    <field name="key" required="yes"/>
    <platform name="android">enter, tab, delete, escape, volume_up, volume_down, home, back, recent_apps, mute, power, play_pause, next, previous</platform>
    <platform name="ios">enter, tab, delete, home, volume_up, volume_down (no back/recent_apps — use swipe gestures)</platform>
    <note>Dismiss keyboard: press_key enter (submits), tap Done/Cancel button, or Android press_key back.</note>
    <example>{"action": "press_key", "key": "enter"}</example>
  </action>

  <action name="toggle">
    <field name="predicate" required="yes"/>
    <field name="state" required="no">Desired state: "on" or "off". If omitted, always toggles. If set, skips when already correct.</field>
    <example>{"action": "toggle", "predicate": {"type": "switch", "text_contains": "Wi-Fi"}, "state": "on"}</example>
  </action>

  <action name="screenshot">
    <field name="file_path" required="yes">Directory to save</field>
    <field name="name">Filename without extension (default: screenshot_TIMESTAMP)</field>
    <example>{"action": "screenshot", "file_path": "/path/to/dir", "name": "login_screen"}</example>
    <returns>screenshot_path</returns>
  </action>

  <action name="navigate">
    <field name="target" required="yes">home, back, recent_apps</field>
    <platform name="ios">back/recent_apps not supported — use swipe gestures.</platform>
    <example>{"action": "navigate", "target": "home"}</example>
  </action>

  <action name="observe">
    <field name="include">ui_tree, screenshot, activity, installed_apps, dom, ocr</field>
    <field name="context">native (default) or web</field>
    <field name="store_as" type="string">Store result in named variable</field>
    <field name="include_keyboard" type="bool" default="false"/>
    <field name="only_visible" type="bool" default="true">MUST be false when collecting data from scrollable lists/search results. MUST be true when interacting with elements — off-screen elements cannot be tapped.</field>
    <field name="filter">text_regex or bounds {"x","y","width","height"} to reduce output</field>
    <note>OCR (iOS only): returns text with tap coordinates. Useful for system dialogs missing from UI tree.</note>
    <example>{"action": "observe", "include": ["ui_tree"], "filter": {"text_regex": "Settings|Wi-Fi"}}</example>
  </action>

  <action name="wait_for">
    <field name="predicate">Required unless stable is true</field>
    <field name="stable" type="bool" default="false">Wait for UI to stop changing</field>
    <field name="timeout_ms" type="int" default="10000"/>
    <field name="poll_interval_ms" type="int" default="500">300 for stable mode</field>
    <note>Stable mode: use before screenshots/assertions after animations.</note>
    <example>{"action": "wait_for", "predicate": {"text": "Welcome"}, "timeout_ms": 5000}</example>
  </action>

  <action name="delay">
    <field name="duration_ms" required="yes"/>
    <example>{"action": "delay", "duration_ms": 1000}</example>
  </action>

  <action name="if_exists">
    <field name="predicate" required="yes"/>
    <field name="then" type="[]Step" required="yes"/>
    <field name="else" type="[]Step"/>
    <example>{"action": "if_exists", "predicate": {"text": "Allow"}, "then": [{"action": "tap", "predicate": {"text": "Allow"}}]}</example>
  </action>

  <action name="kill_app">
    <field name="bundle_id" required="yes"/>
    <example>{"action": "kill_app", "bundle_id": "com.apple.mobilesafari"}</example>
  </action>

  <action name="set_location">
    <field name="lat" type="float" required="yes">-90 to 90</field>
    <field name="lon" type="float" required="yes">-180 to 180</field>
    <platform name="ios">All versions</platform>
    <platform name="android">Emulators all versions, real devices 12+ only</platform>
    <example>{"action": "set_location", "lat": 40.7128, "lon": -74.0060}</example>
  </action>

  <action name="reset_location">
    <example>{"action": "reset_location"}</example>
  </action>

  <action name="siri">
    iOS only. Sends a voice command to Siri service on iOS devices. Auto-approves consent dialogs, captures Siri's response text, then dismisses the Siri UI.
    Use for triggering SiriKit intents and App Shortcuts registered by apps (media playback, messaging, banking shortcuts, etc.).
    The captured response is stored in "siri_response" and returned in the step result. If Siri asks a follow-up question, reformulate the prompt with more detail and call siri again.
    <field name="prompt" required="yes">Voice command text</field>
    <example>{"action": "siri", "prompt": "Search YouTube for cat videos"}</example>
    <example>{"action": "siri", "prompt": "Send an email to john@example.com via Gmail"}</example>
    <note>Check the app's siri field in the installed apps list (observe with include: installed_apps) to see which intents and activities it supports before calling siri.</note>
  </action>
</native-actions>

<web-actions>
  Require select_web_context first. Add "context": "web" to actions. Always try native automation first.
  iOS physical devices only (no simulators). Android physical or emulator.

  <action name="select_web_context">
    <field name="page_id" type="int"/>
    <field name="url_contains" type="string"/>
    <field name="title_contains" type="string"/>
    <example>{"action": "select_web_context", "url_contains": "google.com"}</example>
  </action>

  <action name="tap/type/press_key/wait_for/if_exists">
    Same fields as native but use css_selector or xpath in predicate.
    <example>{"action": "tap", "context": "web", "predicate": {"css_selector": "button.submit"}}</example>
    <example>{"action": "type", "context": "web", "predicate": {"css_selector": "input#email"}, "text": "user@example.com", "clear_first": true}</example>
    Web press_key keys: enter, tab, delete, escape.
  </action>

  <action name="navigate">
    <field name="url" required="yes"/>
    <example>{"action": "navigate", "url": "https://example.com"}</example>
  </action>

  <action name="execute_js">
    <field name="script" required="yes"/>
    <field name="async" type="bool"/>
    <example>{"action": "execute_js", "script": "return document.title"}</example>
  </action>
</web-actions>

<assertions>
  <action name="assert_exists">
    <field name="predicate" required="yes"/>
    <field name="timeout_ms" type="int"/>
    <example>{"action": "assert_exists", "predicate": {"text": "Success"}, "timeout_ms": 3000}</example>
  </action>

  <action name="assert_not_exists">
    <field name="predicate" required="yes"/>
    <example>{"action": "assert_not_exists", "predicate": {"text": "Error"}}</example>
  </action>

  <action name="assert_count">
    <field name="predicate" required="yes"/>
    <field name="count" type="int" required="yes"/>
    <example>{"action": "assert_count", "predicate": {"type": "cell"}, "count": 5}</example>
  </action>

  <action name="assert_screen_changed">
    <field name="threshold_percent" type="int"/>
    <example>{"action": "assert_screen_changed", "threshold_percent": 15}</example>
    <note>Pattern: observe(screenshot) then action then delay then assert_screen_changed. Do NOT observe after the action — it resets the baseline.</note>
  </action>

  <action name="ai_assert">
    <field name="assert_prompt" required="yes"/>
    <field name="include" type="[]string" note="opt-in extra context: screenshot, ocr (iOS). UI tree + the source script are always included."/>
    <field name="timeout_ms" type="int" note="bounds the verdict (LLM/CLI reply), excluding context gathering. Default 60000."/>
    <field name="message" note="prefixes the failure reason"/>
    <example>{"action": "ai_assert", "assert_prompt": "the reply answers the user's question and is not an error", "include": ["screenshot"]}</example>
    <note>Judges a natural-language assertion with the user's configured agent — either an LLM API provider (direct call) or Claude Code (spawned, reports back via report_assertion). Use for non-deterministic content (AI/LLM output, dynamic feeds) where exact-match assertions don't work. Treat as a soft assertion — it is non-deterministic.</note>
  </action>
</assertions>

<metrics>
  <action name="metrics_start">
    <field name="types">system_cpu, system_memory, fps, network, battery, process (requires bundle_id). Default: system_cpu, system_memory.</field>
    <field name="interval_ms" type="int" default="1000"/>
    <field name="label" type="string"/>
    <field name="bundle_id" type="string">Required for process metrics</field>
    <field name="capture_logs" type="bool">Captures iOS syslog / Android logcat at Warning/Error level as JSONL</field>
    <field name="thresholds">{"cpu_high": 80, "fps_low": 45, "fps_jank": 30, "memory_growth_mb_min": 50, "memory_high": 85, "battery_drain_rate": 10}</field>
    <example>{"action": "metrics_start", "types": ["system_cpu", "fps"], "label": "login_flow"}</example>
    <example>{"action": "metrics_start", "capture_logs": true, "label": "debug_session"}</example>
  </action>

  <action name="metrics_stop">
    <field name="format">summary (default) or detailed</field>
    <returns>If capture_logs was enabled, includes logs_file path to JSONL.</returns>
    <example>{"action": "metrics_stop"}</example>
  </action>
</metrics>

<screen-recording>
  Captures screenshots continuously to verify transitional behavior (animations, transitions, loading).
  Confirm with user before using. Animations are non-deterministic — run multiple times for best coverage. Auto-stops on script exit.

  <action name="record_start">
    <field name="file_path">Output directory (default: auto-generated in temp)</field>
  </action>

  <action name="record_stop">
    <field name="file_path">Override output directory</field>
    <returns>recording_path, frame_count, transition_hints (anomalies: jump/flash/stutter/incoherent_motion with from_frame, to_frame, type, delta_percent, region, message)</returns>
    <note>transition_hints contains anomalous frame pairs (from_frame, to_frame). If transition_hints is empty, do not read any frames. If not empty, read only the flagged frame pairs. Read additional frames only if strictly necessary to investigate a flagged anomaly.</note>
  </action>
</screen-recording>

</device-automation-reference>
`;

const TESTING_REF = `<testing-reference>

<important>Read mobai://reference/device-automation to learn how to control devices before interacting with them.</important>

<file-model>
  Tests are .mob files on disk inside project directories. You work with them directly:
  - Use test_list_projects to discover project directories and their .mob files
  - Read .mob files directly from the project directory using filesystem tools
  - Create, edit, rename, and delete .mob files directly — MobAI watches for changes and updates the UI live
  - Use test_run to execute a test on a device — this is the only operation that requires MCP
</file-model>

<rules>
  <rule>Never ask the user for information you can get yourself — use observe, list_apps, get_ui_tree.</rule>
  <rule>Always add wait_for before every element interaction (tap, type, toggle, long_press, double_tap, drag). Exception: the element was asserted on the immediately preceding line.</rule>
  <rule>Always use predicates over coordinates — predicates survive layout changes.</rule>
  <rule>Always prefer UI tree and OCR over screenshots for element discovery.</rule>
  <rule>Your first action must be observe — never ask the user first.</rule>
</rules>

<workflow-create>
  1. Call test_list_projects to find the project directory and existing tests
  2. Observe the current screen on the device
  3. Plan the test steps from the user's description
  4. Write the .mob file directly to the project directory
  5. Run the test with test_run
  6. Fix — if steps fail, read the error, observe the screen, edit the .mob file
  7. Re-run to verify fixes (max 3 retry cycles)
</workflow-create>

<workflow-fix>
  1. Read the .mob file from disk
  2. Analyze the error messages — they reference exact line numbers
  3. Reproduce — run a failing action via DSL to observe device state
  4. Edit the .mob file directly
  5. Re-run with test_run
</workflow-fix>

<error-fixes>
  "multiple elements found" — add disambiguators: type:button, type:cell, bounds:top_half, near "Label", or [index]
  "no element found" — usually timing: add wait_for before the failing line. If present, check text/type or add scroll
  "timeout" — increase timeout value or add a preceding wait_for
  Modifier-only predicates are valid: tap type:button, wait_for type:dialog, assert_exists type:switch near "Label"
</error-fixes>

<cross-platform>
  Keep common steps outside platform blocks. Wrap platform-specific alternatives in paired blocks:
  # android
  navigate back
  # end
  # ios
  tap ~"back"
  # end
</cross-platform>

<stop-conditions>
  Pause and tell the user when:
  - An error cannot be resolved after 3 attempts
  - The observed screen state does not match any expected state
  - A destructive action (uninstall, data deletion) would be required that was not requested
</stop-conditions>

<verification>
  Check before every response:
  1. Does every element interaction have a wait_for on the preceding line?
  2. Are predicates used instead of coordinates wherever possible?
  3. Did you observe the screen before acting?
</verification>

<mob-script-syntax>
  Each line = one test step.

  <actions>
    app "com.example.app"              — launch app
    app "com.example.app" fresh        — kill + launch for clean state
    kill_app "com.example.app"         — force-close app
    tap "Text"                          — tap by text
    tap "Field" near "Label"            — tap near another element
    tap "Edit" near "Profile" direction:below — near with direction
    tap "Item" [2]                      — tap Nth match (0-indexed)
    tap ~"partial"                      — partial text match
    tap /"^\\d+ items"/                  — regex match
    tap "Submit" type:button            — filter by type
    tap "Settings" bounds:top_half      — filter by region (top_half, bottom_half, left_half, right_half, center)
    tap "Cell" parent_of:"Submit"       — find parent containing child
    tap "Submit" enabled:true           — filter by enabled state
    tap "Tab" visible:true selected:false — filter by state
    tap 100,200                         — tap coordinates
    double_tap "Image"                  — double-tap element
    long_press "Message" duration:1500  — long-press (ms)
    type "Field" → "text"              — type into field
    type ~"Field" → "text"             — partial match field
    type "Field" → "text" clear        — clear first
    type "Field" → "text" keep_keyboard — keep keyboard open
    swipe up|down|left|right            — swipe direction
    swipe up distance:long              — short/medium/long
    swipe up duration:500               — custom duration (ms)
    swipe 100,200 to 100,800            — coordinate swipe
    scroll down                         — scroll
    scroll down to "Element"            — scroll until visible
    scroll down to "Footer" max_scrolls:10 — limit attempts
    toggle "Wi-Fi" on|off              — toggle switch
    toggle type:switch near "Wi-Fi" on  — modifier-only
    drag "Item" to "Trash"             — drag element
    drag 100,200 to 300,400 duration:500 — coordinate drag
    drag "App" to "Folder" press_duration:500 hold_duration:200 — press-hold-move-hold-release
    drag_path 100,400 150,300:150 300,500:300 - multi-point path (X,Y:moveMs, first point's :ms = optional press-hold)
    wait_for "Element" timeout:5000     — wait for element
    wait_for type:button bounds:bottom_half timeout:3000 — modifier-only
    delay 1000                          — wait N ms
    press_key home|back|enter           — hardware key
    navigate back|home                  — navigation shortcut
    two_finger_tap "Map"                — two-finger tap
    pinch "Map" scale:0.5               — pinch (scale <1 = zoom out, >1 = zoom in)
    pinch "Photo" scale:2.0             — pinch to zoom in
    hide_keyboard                       — dismiss keyboard
    copy_text "Field"                   — copy text from element
    paste_text "Field"                  — paste clipboard into element
    set_location 40.7128,-74.0060       — simulate GPS location (lat,lon)
    reset_location                      — stop location simulation
    siri "Search YouTube for cats"      — invoke Siri with voice command (iOS only)
    observe                             — observe screen
    screenshot "path.png"               — take screenshot
  </actions>

  <assertions>
    assert_exists "Element"             — element is on screen
    assert_not_exists "Element"         — element is NOT on screen
    assert_exists "Header" bounds:top_right — with region filter
    assert_exists value:"hello"         — assert a field's entered value (exact); sees typed content, not placeholder
    assert_exists value_contains:"@mail" — assert a substring of the entered value
    assert_count "Cell" expected:5      — element count
    checkpoint "name"                   — mark checkpoint
  </assertions>

  <failure-handling>
    tap "Submit" on_fail:skip           — skip on failure
    tap "Submit" on_fail:retry retries:3 retry_delay:1000 — retry on failure
  </failure-handling>

  <metadata>
    # Comment text                      — section header
    # Tags: smoke, login               — tags for filtering
    # Device: iPhone 15                 — device filter
    # Timeout: 30000                    — global timeout (ms)
    # On-Fail: abort                    — abort or continue
    # Param: username                   — declare a parameter (no default)
    # Param: timeout = 5000             — declare with default value
  </metadata>

  <variables>
    \${name} substitution: use \${param_name} anywhere in a step line to reference a parameter or extracted value.
    Parameters declared via # Param: are available as \${name}. Extracted values (see extract below) are also available.
    Example:
      # Param: email
      # Param: password = secret123
      type "Email" → "\${email}"
      type "Password" → "\${password}"
  </variables>

  <extract>
    extract key from "Element"           — extract text from matched element into \${key}
    extract key from #AccessibilityID    — extract text by accessibility ID
    extract key from ~"partial" regex:"(\\d+)" — extract with regex capture group
    extract key screenshot               — save screenshot to disk, store path in \${key}
    extract key = "literal value"        — store a literal string in \${key}
    Extracted values are available as \${key} in subsequent steps and returned in the API response as "extracted" map.
    The optional regex: modifier applies a regex to the matched text; if it has a capture group, group 1 is stored.
  </extract>

  <platform-blocks>
    # ios / # android                   — open platform block
    # end                               — close block
    Lines outside blocks run on BOTH platforms.
    No nesting. Every open MUST have a matching # end.
  </platform-blocks>

  <conditionals>
    if_exists "Element" {
        tap "Element"
    } else {
        tap "Other"
    }
  </conditionals>

  <run-includes>
    run "./path/to/other.mob"            — inline another .mob file at compile time
    run "./auth/login.mob" email="x@y" password="hunter2" — pass args; values overlay the target file's # Param: defaults
    run "/abs/path/to/file.mob"          — absolute path is allowed
    run "~/shared/login.mob"             — ~ expands to the user home directory
    Path is relative to the calling file's directory unless absolute. Args use key=value (no colon, no quotes around the key). Values may contain \${name} references that resolve from the caller's scope at execute time. The target file's extracts flow back into the caller's scope (flat namespace).
  </run-includes>
</mob-script-syntax>

<apis>
  Mobile apps can be turned into callable APIs by saving parameterized .mob scripts to the APIs directory.

  <directory>{MOBAI_DATA_DIR}/apis/ — global directory for API scripts. Each .mob file is a named API. Subdirectories are supported and become slash-separated names (e.g. apis/youtube/search.mob is callable as "youtube/search"). Resolves to ~/Library/Application Support/mobai/data/apis on macOS, %AppData%/mobai/data/apis on Windows, ~/.config/mobai/data/apis on Linux.</directory>

  <workflow-create-api>
    When the user asks to create an API from a mobile app flow:
    1. Observe the app and understand the flow
    2. Write a .mob script with # Param: declarations for inputs and extract actions for outputs
    3. Use app "bundle.id" fresh to ensure a clean start — the app may be left on any screen from a previous call
    4. Save it to {MOBAI_DATA_DIR}/apis/{name}.mob — flat (gmail-send.mob) or nested (gmail/send.mob)
    5. Test it with test_run using project_dir: {MOBAI_DATA_DIR}/apis/ and case_path: {name}.mob
    6. List available APIs:    GET  /api/v1/apis
       Call an API:            POST /api/v1/apis/run/{name}  with {"device_id": "...", "params": {...}}
       The {name} segment is the path inside apis/ minus the .mob extension.
       API runs do not persist results to .mobai/runs/ — only the extracted values come back in the response.
  </workflow-create-api>

  <example-api>
    # Search YouTube
    # Param: query
    siri "Search YouTube for \${query}"
    wait_for ~"\${query}" timeout:5000
    extract result from ~"\${query}"

    POST /api/v1/apis/run/youtube-search {"device_id":"X","params":{"query":"cats"}}
    → {"result": "cats"}
  </example-api>
</apis>

</testing-reference>
`;

const DEBUGGING_REF = `<debugging-reference>

<scope>
  Live debugging of an iOS app running on a connected device or booted simulator. Attach lldb, set breakpoints, inspect stack and variables, evaluate Swift/ObjC expressions, continue. Six MCP tools cover the full workflow.

  Requires: a debug-signed build of the app (debug provisioning profile with get-task-allow). App Store / TestFlight builds cannot be attached. iOS 17+ for physical devices. macOS host with Xcode installed.
</scope>

<workflow>
  Bps fire asynchronously when the user (or your execute_dsl) drives the UI. The agent observes via debug_state, not by waiting on debug_continue.

    1. debug_attach {device_id, bundle_id, breakpoints: ["File.swift:42"]}
    2. (trigger the action — usually via execute_dsl)
    3. debug_state {device_id, include_stack: true, include_vars: true}   // poll until state == "paused"
    4. debug_eval {device_id, expression: "po self.viewModel.user"}
    5. debug_step {device_id, direction: "continue"}                        // resume; fire-and-forget
    6. (loop 2-5 as needed)
    7. debug_detach {device_id}

  direction: "continue" is fire-and-forget. For deterministic line-stepping use "in" / "over" / "out" — those block (~ms) and return fresh stack + locals.
</workflow>

<tools>
  debug_attach — start a debug session.
    device_id (required), bundle_id OR pid (one required), breakpoints (optional [string]),
    stop_on_entry (optional bool, simulator only).

  debug_state — query the current session state.
    device_id (required), include_stack (bool, default false), include_vars (bool, default false), include_threads (bool, default false).
    Default returns just {state, breakpoints}. Stack, frame[0] locals, and the thread list are opt-in (each costs a round-trip; ~few seconds on physical hardware).

  debug_breakpoint — add or remove a breakpoint.
    device_id, action: "add" | "remove", spec (for add), id (for remove).

  debug_eval — evaluate a Swift/ObjC expression at the current pause.
    device_id, expression, frame_id (optional). Session must be paused.

  debug_step — advance the target.
    device_id, direction one of:
      "in" / "over" / "out" — block ~ms until next stop; return {state, breakpoints, stack, frame0_locals}.
      "continue"            — fire-and-forget; return {state, breakpoints}; poll debug_state for next stop.
    include_stack / include_vars (default true; ignored for "continue").

  debug_detach — end the session. kill (default false) terminates the debuggee.
</tools>

<breakpoint-specs>
  Three accepted forms. Prefer file:line for application code.

    "File.swift:42"             file:line (basename or absolute path)
    "Module.Type.method"        Swift demangled prefix (NO parameter signature, NO return type)
    "-[ClassName method:]"      ObjC method
    "swift_willThrow"           bare runtime symbol

  Caveats:
    - Release/optimized builds without DWARF return verified=false.
    - swift_willThrow / objc_exception_throw fire on EVERY internal Swift/ObjC throw — Apple frameworks throw constantly under the hood. Use only when actually hunting an uncaught error.
</breakpoint-specs>

<eval-expressions>
  debug_eval runs lldb expression --. Accepts ObjC++ syntax by default; Swift syntax when frame is in a Swift compile unit.

    p expr            evaluate, default-format
    po expr           call objects description
    frame variable    list all locals (no eval — fast)
    bt                full backtrace
    image lookup -n NAME   resolve a symbol name to module + addresses
</eval-expressions>

<state-machine>
  paused — debug_eval works; debug_continue resumes.
  running — debug_eval returns 409; debug_breakpoint still works for next hit.
  dead — exited or crashed. Detach and reattach.

  While the foreground app on a device is paused at a bp, UI input via execute_dsl tap/swipe blocks at WDA until you debug_continue.
</state-machine>

<common-failures>
  "lldb-dap not found" — install Xcode 15+.
  "device debugging requires iOS 17+" — physical-device path needs the on-device tunnel.
  "bundle is not installed on device" — install_app first with a debug-signed build.
  verified=false — symbol mangling mismatch or no debug info. Try image lookup -n NAME via debug_eval.
  "___lldb_unnamed_symbol_*" in stacks — dSYM not loaded. For device builds, run debug_eval "target symbols add /path/to/MyApp.app.dSYM".
</common-failures>

</debugging-reference>
`;
