import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(filePath) {
  const full = path.join(root, filePath);
  assert.ok(fs.existsSync(full), `Missing file: ${filePath}`);
  return fs.readFileSync(full, "utf8");
}

test("demo site files exist", () => {
  read("index.html");
  read("assets/styles.css");
  read("assets/app.js");
  read("assets/background-templates.js");
  read("assets/vector-template-loader.js");
  read("assets/structures/index.json");
  read("assets/structures/bridge.svg");
  read("assets/structures/industrial_frame.svg");
});

test("index.html has required premium showcase sections", () => {
  const html = read("index.html");
  const requiredSections = [
    'id="hero"',
    'id="projects"',
    'id="map"',
    'id="team"',
    'id="approach"',
    'id="contact"',
  ];

  for (const section of requiredSections) {
    assert.ok(html.includes(section), `Missing section marker: ${section}`);
  }

  assert.ok(
    html.includes('id="bg-canvas"'),
    "Background canvas layer is required"
  );
  assert.ok(
    html.includes('id="story-map"'),
    "SVG story map layer is required"
  );
});

test("index links static assets", () => {
  const html = read("index.html");
  assert.ok(
    html.includes('href="assets/styles.css"'),
    "styles.css link is missing"
  );
  assert.ok(
    html.includes('src="assets/app.js"') && html.includes('type="module"'),
    "app.js script include is missing"
  );
});

test("runtime script includes adaptive motion logic", () => {
  const js = read("assets/app.js");
  assert.ok(
    js.includes("prefers-reduced-motion"),
    "Motion safety handling is missing"
  );
  assert.ok(js.includes("requestAnimationFrame"), "Animation loop is missing");
  assert.ok(
    js.includes("vector-template-loader.js"),
    "Vector template loader import is required"
  );
  assert.ok(
    js.includes("downsampleTemplateForProfile"),
    "Profile-aware downsampling branch is required"
  );
});

test("runtime script has focus sync and local link controls", () => {
  const js = read("assets/app.js");
  assert.ok(js.includes("setFocus"), "setFocus API is required");
  assert.ok(
    js.includes("maxLinksPerParticle"),
    "Local link cap is required"
  );
  assert.ok(js.includes("alphaCap"), "Alpha cap for links is required");
  assert.ok(js.includes('"bound"') || js.includes("'bound'"), "Bound role is required");
  assert.ok(js.includes('"free"') || js.includes("'free'"), "Free role is required");
  assert.ok(js.includes("lineHints"), "Topology render must use lineHints");
  assert.ok(
    js.includes("topologyEdgeCapByProfile"),
    "Topology edge cap by profile is required"
  );
});

test("runtime script defines hold/crumble/rebuild phase timings", () => {
  const js = read("assets/app.js");
  assert.ok(js.includes('"hold"'), "Hold phase is required");
  assert.ok(js.includes('"crumble"'), "Crumble phase is required");
  assert.ok(js.includes('"rebuild"'), "Rebuild phase is required");
  assert.ok(
    js.includes("cycleMs: 24000") || js.includes("cycleMs:24000"),
    "Cycle timing (24s) is required"
  );
  assert.ok(
    js.includes("crumbleMs: 4000") || js.includes("crumbleMs:4000"),
    "Crumble timing (4s) is required"
  );
  assert.ok(
    js.includes("rebuildMs: 6000") || js.includes("rebuildMs:6000"),
    "Rebuild timing (6s) is required"
  );
  assert.ok(
    js.includes("holdMs: 14000") || js.includes("holdMs:14000"),
    "Hold timing (14s) is required"
  );
});

test("runtime script keeps no-crumble/no-rebuild branch for reduced-motion", () => {
  const js = read("assets/app.js");
  assert.ok(
    js.includes('profile === "reduced"') || js.includes("profile==='reduced'"),
    "Reduced profile branch is required"
  );
  assert.ok(
    js.includes('phaseState.phase = "hold"'),
    "Reduced branch must pin phase to hold"
  );
  assert.ok(
    js.includes("if (profile === \"reduced\")") && js.includes("return;"),
    "Reduced branch must short-circuit phase transitions"
  );
});

test("runtime script includes free particle profile ratios", () => {
  const js = read("assets/app.js");
  assert.ok(js.includes("ratioByProfile"), "ratioByProfile config is required");
  assert.ok(
    /high:\s*0\.3\b/.test(js),
    "Expected free ratio high = 0.30"
  );
  assert.ok(
    /medium:\s*0\.25/.test(js),
    "Expected free ratio medium = 0.25"
  );
  assert.ok(
    /low:\s*0\.18/.test(js),
    "Expected free ratio low = 0.18"
  );
  assert.ok(
    /reduced:\s*0\.2/.test(js),
    "Expected free ratio reduced = 0.20"
  );
  assert.ok(
    js.includes("phaseState.phase === \"hold\" ? 1 : 0.55") ||
      js.includes("phaseState.phase==='hold'?1:0.55"),
    "Expected phase-aware free link attenuation"
  );
});

test("runtime script defines staged rebuild wave windows", () => {
  const js = read("assets/app.js");
  assert.ok(js.includes("REBUILD_WAVE_WINDOWS"), "Rebuild wave windows constant is required");
  assert.ok(
    js.includes("foundation: [0.05, 0.25]") || js.includes("foundation:[0.05,0.25]"),
    "Foundation wave window is required"
  );
  assert.ok(
    js.includes("supports: [0.2, 0.5]") || js.includes("supports:[0.2,0.5]"),
    "Supports wave window is required"
  );
  assert.ok(
    js.includes("braces: [0.62, 0.95]") || js.includes("braces:[0.62,0.95]"),
    "Braces wave window is required"
  );
});

test("structure manifest file has bridge and industrial entries", () => {
  const raw = read("assets/structures/index.json");
  const parsed = JSON.parse(raw);
  assert.ok(Array.isArray(parsed.templates), "templates must be an array");
  const ids = parsed.templates.map((item) => item.id);
  assert.ok(ids.includes("bridge"), "bridge template manifest entry missing");
  assert.ok(
    ids.includes("industrial_frame"),
    "industrial_frame template manifest entry missing"
  );
});

test("architecture docs mention phase engine, vector ingest, and reduced policy", () => {
  const doc04 = read("docs/architecture/04-animation-engine-canvas2d.md");
  const doc08 = read("docs/architecture/08-performance-budget.md");
  const doc09 = read("docs/architecture/09-accessibility-and-motion.md");
  const adr02 = read("docs/decisions/ADR-002-animation-strategy.md");

  assert.ok(
    doc04.includes("BuildPhase"),
    "Build phase contract must be documented in 04"
  );
  assert.ok(
    doc04.includes("VectorTemplateManifest"),
    "Vector manifest contract must be documented in 04"
  );
  assert.ok(
    doc04.includes("parseSvgToTemplate"),
    "SVG parser ingest contract must be documented in 04"
  );
  assert.ok(
    doc04.includes("setFocus"),
    "Focus runtime API must be documented in 04"
  );
  assert.ok(
    doc08.includes("parser warmup budget"),
    "Parser warmup budget must be documented in 08"
  );
  assert.ok(
    doc08.includes("rebuild frame budget"),
    "Rebuild frame budget must be documented in 08"
  );
  assert.ok(
    doc08.includes("free-link cap"),
    "Free-link cap must be documented in 08"
  );
  assert.ok(
    doc09.includes("no crumble") || doc09.includes("no-crumble"),
    "Reduced-motion no-crumble behavior must be documented in 09"
  );
  assert.ok(
    doc09.includes("no rebuild") || doc09.includes("no-rebuild"),
    "Reduced-motion no-rebuild behavior must be documented in 09"
  );
  assert.ok(
    doc04.includes("Appearance") && doc04.includes("Animation") && doc04.includes("Group Interaction"),
    "04 must document bgTest tab groups for diagnostics"
  );
  assert.ok(
    doc08.includes("tabbed") || doc08.includes("tabs"),
    "08 must document tabbed debug UI constraints for bgTest"
  );
  assert.ok(
    doc09.includes("tab") && doc09.includes("keyboard"),
    "09 must document keyboard-accessible tab behavior in bgTest"
  );
  assert.ok(
    adr02.includes("tabbed") || adr02.includes("tabs"),
    "ADR-002 must mention tabbed bgTest diagnostics surface"
  );
});

test("styles define design system primitives", () => {
  const css = read("assets/styles.css");
  assert.ok(css.includes(":root"), "CSS variables are required");
  assert.ok(css.includes("--bg"), "Background color token is required");
  assert.ok(css.includes("@keyframes"), "Animation keyframes are required");
});

test("runtime script supports bgTest mode toggle via URL query", () => {
  const js = read("assets/app.js");
  assert.ok(
    js.includes("URLSearchParams(window.location.search)"),
    "bgTest mode must read query params from window.location.search"
  );
  assert.ok(js.includes("bgTest"), "bgTest query key handling is required");
  assert.ok(
    js.includes('classList.toggle("is-bg-test"'),
    "bgTest mode must toggle is-bg-test class on body"
  );
});

test("runtime script skips non-background UI setup in bgTest mode", () => {
  const js = read("assets/app.js");
  assert.match(
    js,
    /if\s*\(\s*!backgroundTestMode\s*\)\s*\{[\s\S]*setupMapInteractions\(engine\);[\s\S]*animateCounters\(\);[\s\S]*setYear\(\);[\s\S]*\}/,
    "bgTest mode must guard non-background UI setup"
  );
});

test("styles restore legacy grid visibility and remove overlay mask", () => {
  const css = read("assets/styles.css");
  assert.match(
    css,
    /--bg-grid-opacity:\s*0\.46\b/,
    "Legacy grid opacity baseline (0.46) must be restored in CSS variables"
  );
  assert.match(
    css,
    /\.noise-layer\s*\{[\s\S]*opacity:\s*var\(--bg-grid-opacity\)/,
    "noise-layer opacity must be controlled via bg grid opacity variable"
  );
  assert.ok(
    !css.includes(".noise-layer::before"),
    "noise-layer overlay mask should be removed to restore visible square grid"
  );
});

test("styles define clean background-only viewport for bgTest mode", () => {
  const css = read("assets/styles.css");
  assert.match(
    css,
    /body\.is-bg-test\s*\{[\s\S]*overflow:\s*hidden/,
    "bgTest mode must disable page scrolling"
  );
  assert.match(
    css,
    /body\.is-bg-test\s+\.site-header,\s*body\.is-bg-test\s+main,\s*body\.is-bg-test\s+\.site-footer\s*\{[\s\S]*display:\s*none/,
    "bgTest mode must hide foreground content containers"
  );
});

test("runtime script includes bgTest control panel and live debug actions", () => {
  const js = read("assets/app.js");
  assert.ok(js.includes("bg-test-controls"), "bgTest control panel id must exist in runtime");
  assert.ok(js.includes("role=\"tablist\""), "bgTest panel must render a tablist");
  assert.ok(js.includes("role=\"tabpanel\""), "bgTest panel must render tab panels");
  assert.ok(js.includes("aria-selected"), "bgTest tabs must expose aria-selected");
  assert.ok(js.includes("appearance"), "bgTest tabs must include appearance section");
  assert.ok(js.includes("animation"), "bgTest tabs must include animation section");
  assert.ok(js.includes("interaction"), "bgTest tabs must include interaction section");
  assert.ok(js.includes("Pause"), "Pause control for bgTest panel is required");
  assert.ok(js.includes("Resume"), "Resume control for bgTest panel is required");
  assert.ok(js.includes("Reset"), "Reset preset for bgTest panel is required");
  assert.ok(js.includes("High"), "High preset for bgTest panel is required");
  assert.ok(js.includes("Medium"), "Medium preset for bgTest panel is required");
  assert.ok(js.includes("Low"), "Low preset for bgTest panel is required");
  assert.ok(
    js.includes("applyDebugOverrides"),
    "Runtime must expose applyDebugOverrides hook for bgTest controls"
  );
});

test("runtime script includes appearance and group interaction debug keys", () => {
  const js = read("assets/app.js");
  assert.ok(js.includes("boundPointColor"), "Appearance key boundPointColor is required");
  assert.ok(js.includes("gridOpacity"), "Appearance key gridOpacity is required");
  assert.ok(js.includes("boundBoundStrength"), "Group interaction key boundBoundStrength is required");
  assert.ok(js.includes("freeBoundGateScale"), "Group interaction key freeBoundGateScale is required");
  assert.ok(js.includes("clusterAdjacencySpan"), "Group interaction key clusterAdjacencySpan is required");
});

test("runtime script keeps bgTest sliders session-only", () => {
  const js = read("assets/app.js");
  assert.ok(
    !js.includes("localStorage"),
    "bgTest controls must not persist settings to localStorage"
  );
  assert.ok(
    !js.includes("sessionStorage"),
    "bgTest controls must not persist settings to sessionStorage"
  );
  assert.ok(
    !js.includes("history.replaceState") && !js.includes("history.pushState"),
    "bgTest controls must not sync tuning values into URL history"
  );
});

test("styles include tabbed bgTest controls and tunable grid variables", () => {
  const css = read("assets/styles.css");
  assert.ok(css.includes("--bg-grid-rgb"), "Grid color CSS variable is required");
  assert.ok(css.includes("--bg-grid-opacity"), "Grid opacity CSS variable is required");
  assert.ok(css.includes("--bg-grid-size"), "Grid size CSS variable is required");
  assert.ok(css.includes(".bg-test-tabs"), "Tabbed control styles are required");
  assert.ok(css.includes(".bg-test-tab"), "Tab button styles are required");
  assert.ok(css.includes(".bg-test-panel"), "Tab panel styles are required");
  assert.ok(css.includes(".bg-test-panel[hidden]"), "Hidden tab panel style is required");
});
