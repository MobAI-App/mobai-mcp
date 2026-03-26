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
];

export function getResourceContent(uri: string): string | null {
  switch (uri) {
    case "mobai://reference/device-automation":
      return DEVICE_AUTOMATION_REF;
    case "mobai://reference/testing":
      return TESTING_REF;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Resource content — copied verbatim from Go resources.go
// ---------------------------------------------------------------------------

const DEVICE_AUTOMATION_REF = `<device-automation-reference>

<guide>
  All device interaction goes through DSL scripts via MCP execute_dsl tool or POST /devices/{id}/dsl/execute.

  <script-format>
    {"version": "0.2", "steps": [...actions...], "on_fail": {"strategy": "retry", "max_retries": 2}}
    Every script must include "version": "0.2" and a "steps" array.
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
    Default (explore mode): non-last observe actions are skipped — only final observe executes. Use "mode": "deterministic" when you need every observe to execute (observe → act → observe → act → observe).
    Example: {"version": "0.2", "mode": "deterministic", "steps": [{"action": "observe", "include": ["ui_tree"]}, {"action": "tap", "predicate": {"text": "Next"}}, {"action": "observe", "include": ["ui_tree"]}]}
  </execution-modes>

  <workflow>Observe screen → plan → act via execute_dsl → verify (end script with wait_for stable + observe) → repeat until done.</workflow>

  <screenshot-tools>
    get_screenshot — fast low-quality image for LLM visual analysis.
    save_screenshot — full-quality PNG for reporting, debugging, or sharing.
  </screenshot-tools>

  <infinite-scrolling>To collect data from infinite-scrolling views (feeds, search results), scroll to load a batch first, then observe with only_visible:false to get all loaded items in one go.</infinite-scrolling>

  <troubleshooting>
    Element not visible — use scroll with to_element to find it.
    App launches and page transitions take time — use wait_for or delay.
    Observe before acting on unfamiliar screens.
  </troubleshooting>
</guide>

<common-types>
  <coordinates>{"x": int, "y": int}</coordinates>
  <target-element>{"predicate": Predicate}</target-element>

  <predicate context="native">
    <note>Prefer text_contains or text_regex over text (exact match) — UI text often changes with state, locale, or dynamic content. Exact match breaks easily. Prefer text fields over label fields — text is what the user sees on screen and is more reliable.</note>
    <field name="text" type="string">Exact match — use only when the full text is short, static, and unique</field>
    <field name="text_contains" type="string">Substring, case-insensitive — preferred for most matching</field>
    <field name="text_starts_with" type="string">Prefix match</field>
    <field name="text_regex" type="string">Regex pattern — use for dynamic text (numbers, dates, counts)</field>
    <field name="type" type="string">button, input, switch, text, image, cell, scrollview</field>
    <field name="label" type="string">Accessibility label (exact) — use only when text fields are empty</field>
    <field name="label_contains" type="string">Accessibility label (partial) — use only when text fields are empty</field>
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
    <example>{"action": "open_app", "bundle_id": "com.apple.Preferences"}</example>
    <note>If open_app fails or the app disappears immediately after launch, the app has likely crashed. Do NOT retry or try alternative launch methods — start crash investigation instead. Use metrics_start with capture_logs: true to capture device logs, then diagnose.</note>
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
    <field name="max_scrolls" type="int"/>
    <field name="amount">small, page, full</field>
    <example>{"action": "scroll", "direction": "down", "to_element": {"predicate": {"text": "Privacy"}}, "max_scrolls": 10}</example>
  </action>

  <action name="drag">
    <field name="from" type="TargetElement" required="one-of"/>
    <field name="from_coords" type="Coordinates" required="one-of"/>
    <field name="to_element" type="TargetElement" required="one-of"/>
    <field name="to_coords" type="Coordinates" required="one-of"/>
    <field name="duration_ms" type="int"/>
    <field name="press_duration_ms" type="int">Press-and-hold before drag (for moving app icons)</field>
    <example>{"action": "drag", "from": {"predicate": {"text": "Item"}}, "to_element": {"predicate": {"text": "Trash"}}}</example>
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
    <field name="state" required="yes">on or off</field>
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
  </action>
</screen-recording>

</device-automation-reference>
`;

const TESTING_REF = `<testing-reference>

<important>Read mobai://reference/device-automation to learn how to control devices before interacting with them.</important>

<rules>
  <rule>Test scripts are ONLY accessible via MCP test_* tools. There are NO .mob files on disk. Do NOT use grep, find, cat, or any filesystem commands to look for scripts.</rule>
  <rule>Never ask the user for information you can get yourself — use observe, list_apps, get_ui_tree.</rule>
  <rule>Always add wait_for before every element interaction (tap, type, toggle, long_press, double_tap, drag). Exception: the element was asserted on the immediately preceding line.</rule>
  <rule>Always use predicates over coordinates — predicates survive layout changes.</rule>
  <rule>Always prefer UI tree and OCR over screenshots for element discovery.</rule>
  <rule>Your first action must be observe — never ask the user first.</rule>
</rules>

<workflow-create>
  1. Observe the current screen
  2. Plan the test steps from the user's description
  3. Execute each action via DSL — add wait_for before every element interaction
  4. Assert after key actions — verify expected state with assert_exists/assert_not_exists
  5. Output the full script using MCP test tools
  6. Verify — run the full script end-to-end
  7. Fix — if steps fail, observe the screen, fix the failing lines
  8. Re-run to verify fixes (max 3 retry cycles)
</workflow-create>

<workflow-fix>
  1. Read the current script
  2. Analyze the error messages — they reference exact line numbers
  3. Reproduce — run the failing line individually via DSL to observe device state
  4. Fix — update, insert, or delete lines as needed
  5. Verify — re-run the test
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
  1. Did you use MCP tools for all script mutations? (bare .mob lines in text are silently ignored)
  2. Does every element interaction have a wait_for on the preceding line?
  3. Are predicates used instead of coordinates wherever possible?
  4. Did you observe the screen before acting?
</verification>

<mob-script-syntax>
  Each line = one test step.

  <actions>
    app "com.example.app"              — launch app
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
    drag "App" to "Folder" press_duration:500 — press-and-drag
    wait_for "Element" timeout:5000     — wait for element
    wait_for type:button bounds:bottom_half timeout:3000 — modifier-only
    delay 1000                          — wait N ms
    press_key home|back|enter           — hardware key
    navigate back|home                  — navigation shortcut
    observe                             — observe screen
    screenshot "path.png"               — take screenshot
  </actions>

  <assertions>
    assert_exists "Element"             — element is on screen
    assert_not_exists "Element"         — element is NOT on screen
    assert_exists "Header" bounds:top_right — with region filter
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
  </metadata>

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
</mob-script-syntax>

</testing-reference>
`;
