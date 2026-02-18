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
  read("assets/themes/default.json");
  read("assets/themes/dark.json");
  read("assets/themes/light.json");
  read("assets/structures/index.json");
  read("assets/structures/bridge.svg");
  read("assets/structures/industrial_frame.svg");
});

test("default theme file has required schema and token keys", () => {
  const raw = read("assets/themes/default.json");
  const parsed = JSON.parse(raw);
  assert.equal(parsed.version, 1, "Theme schema version must be 1");
  assert.ok(typeof parsed.name === "string" && parsed.name.length > 0, "Theme name is required");
  assert.ok(parsed.tokens && typeof parsed.tokens === "object", "Theme tokens object is required");
  const required = [
    "--bg",
    "--bg-soft",
    "--bg-radial-start",
    "--bg-radial-end",
    "--surface",
    "--surface-strong",
    "--line",
    "--text",
    "--text-dim",
    "--accent",
    "--accent-warm",
    "--danger",
    "--shadow",
    "--bg-grid-rgb",
    "--bg-grid-opacity",
    "--bg-grid-size",
    "--control-panel-border",
    "--control-panel-bg",
    "--control-panel-shadow",
    "--control-btn-border",
    "--control-btn-bg",
    "--control-tab-border",
    "--control-tab-bg",
    "--theme-tab-active-bg",
    "--theme-tab-active-border",
    "--bg-test-tab-active-bg",
    "--bg-test-tab-active-border",
    "--control-input-border",
    "--control-input-bg",
    "--header-bg",
    "--nav-hover-bg",
    "--section-gradient-start",
    "--section-gradient-mid",
    "--section-gradient-end",
    "--btn-primary-mid",
    "--btn-primary-end",
    "--btn-primary-text",
    "--btn-primary-shadow",
    "--btn-ghost-border",
    "--btn-ghost-bg",
    "--card-active-border",
    "--map-shell-bg",
    "--map-bg-fill",
    "--map-region-fill",
    "--map-region-stroke",
    "--map-node-pulse-fill",
    "--map-node-pulse-stroke",
    "--route-gradient-start",
    "--route-gradient-end",
    "--canvas-bound-point",
    "--canvas-free-point",
    "--canvas-topology-link",
    "--canvas-free-link",
    "--canvas-cross-link",
    "--canvas-gradient-start",
    "--canvas-gradient-end",
  ];
  required.forEach((key) => {
    assert.ok(key in parsed.tokens, `Theme token ${key} must exist`);
  });
});

test("light and dark theme files are present and valid", () => {
  const required = ["dark", "light"];
  required.forEach((name) => {
    const raw = read(`assets/themes/${name}.json`);
    const parsed = JSON.parse(raw);
    assert.equal(parsed.version, 1, `${name} theme schema version must be 1`);
    assert.ok(typeof parsed.name === "string" && parsed.name.length > 0, `${name} theme name is required`);
    assert.ok(parsed.tokens && typeof parsed.tokens === "object", `${name} theme tokens are required`);
    assert.ok(parsed.tokens["--bg"], `${name} theme must define --bg`);
    assert.ok(parsed.tokens["--text"], `${name} theme must define --text`);
    assert.ok(parsed.tokens["--accent"], `${name} theme must define --accent`);
  });
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

test("index.html includes single-source intro contract and initial intro phase", () => {
  const html = read("index.html");
  assert.ok(
    html.includes('data-intro-phase="idle"'),
    "Body should declare initial intro phase"
  );
  assert.ok(
    html.includes('class="brand-text"'),
    "Primary brand text element is required for single-source intro"
  );
  assert.equal(
    html.includes('id="intro-sequence"'),
    false,
    "Intro overlay container must be removed in single-source intro"
  );
  assert.equal(
    html.includes('class="intro-brand-text"'),
    false,
    "Intro clone brand text marker must be removed"
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

test("runtime script includes intro timeline orchestration and completion event", () => {
  const js = read("assets/app.js");
  assert.ok(
    js.includes("logistruct:intro-complete"),
    "Intro completion event is required"
  );
  assert.ok(
    js.includes("runIntroSequence"),
    "Intro runtime orchestrator is required"
  );
  assert.ok(
    js.includes("data-intro-phase"),
    "Intro runtime should control body data-intro-phase state"
  );
  assert.ok(
    js.includes("is-intro-scroll-lock"),
    "Intro runtime should toggle intro scroll lock class"
  );
  assert.ok(
    js.includes("fail-safe") || js.includes("failsafe"),
    "Intro runtime should include fail-safe handling"
  );
  assert.ok(
    js.includes('NAV: "nav"') &&
      js.includes("setIntroPhase(INTRO_PHASES.NAV)") &&
      js.includes("setIntroPhase(INTRO_PHASES.REVEAL)"),
    "Intro runtime should include nav phase between move and reveal"
  );
  assert.ok(
    js.includes("buildBrandCenterTransform") &&
      js.includes("applyBrandIntroStartState") &&
      js.includes("clearBrandInlineIntroState"),
    "Intro runtime should use single-source brand transform helpers"
  );
  assert.equal(
    js.includes("lockIntroLabelToBrandTarget"),
    false,
    "Intro runtime should not use clone handoff API"
  );
  assert.equal(
    js.includes("is-intro-brand-lock"),
    false,
    "Intro runtime should not depend on brand-lock handoff class"
  );
  assert.equal(
    js.includes("intro-brand-text"),
    false,
    "Intro runtime should not reference cloned intro brand text"
  );
  assert.equal(
    js.includes("intro-sequence"),
    false,
    "Intro runtime should not query intro overlay container"
  );
});

test("runtime script includes intro skip rules for special modes and reduced motion", () => {
  const js = read("assets/app.js");
  assert.ok(
    js.includes("backgroundTestMode || themeEditorMode"),
    "Intro must skip in bgTest/themeEditor modes"
  );
  assert.ok(
    js.includes("prefersReduced.matches"),
    "Intro must include reduced-motion branch"
  );
  assert.ok(
    js.includes("(max-width: 760px)") || js.includes("is-intro-mobile-nav-skip"),
    "Intro must include mobile nav-expand skip logic"
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

test("styles include intro phase state contracts and nav expand rules", () => {
  const css = read("assets/styles.css");
  assert.equal(
    css.includes("#intro-sequence"),
    false,
    "Intro overlay styles should be removed for single-source intro"
  );
  assert.equal(
    css.includes(".intro-brand-text"),
    false,
    "Intro clone brand text styles should be removed"
  );
  assert.ok(
    css.includes('data-intro-phase="hold"') &&
      css.includes('data-intro-phase="move"') &&
      css.includes('data-intro-phase="nav"') &&
      css.includes('data-intro-phase="reveal"') &&
      css.includes('data-intro-phase="done"') &&
      css.includes('data-intro-phase="skip"') &&
      css.includes('data-intro-phase="reduced"'),
    "All intro phases should be represented in CSS state rules"
  );
  assert.ok(
    css.includes("is-intro-scroll-lock"),
    "Intro scroll lock class styles are required"
  );
  assert.ok(
    css.includes("transform-origin: left"),
    "Desktop menu expand should use left transform origin"
  );
  assert.ok(
    css.includes('data-intro-phase="move"] .main-nav'),
    "Move phase should explicitly keep nav hidden before nav phase starts"
  );
  assert.ok(
    css.includes('data-intro-phase="nav"] .main-nav'),
    "Nav phase should explicitly reveal desktop navigation"
  );
  assert.ok(
    css.includes('data-intro-phase="nav"] .brand-mark') &&
      css.includes('data-intro-phase="reveal"] .brand-mark'),
    "Brand mark should remain hidden through nav and reveal after nav step"
  );
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

test("runtime script supports theme editor mode and theme file query", () => {
  const js = read("assets/app.js");
  assert.ok(js.includes("themeEditor"), "themeEditor query key handling is required");
  assert.ok(js.includes("is-theme-editor"), "themeEditor mode must toggle body class");
  assert.ok(js.includes("assets/themes/"), "theme loader path must use assets/themes/");
  assert.ok(js.includes(".json"), "theme loader should fetch JSON file");
  assert.ok(js.includes("--canvas-bound-point"), "theme token list should include canvas point color");
  assert.ok(js.includes("--route-gradient-start"), "theme token list should include route gradient start");
  assert.ok(js.includes("THEME_TOKENS_APPLIED_EVENT"), "theme updates should publish a runtime event");
});

test("runtime script handles bgTest and themeEditor conflict by ignoring both", () => {
  const js = read("assets/app.js");
  assert.ok(
    js.includes("backgroundTestMode && themeEditorMode"),
    "Runtime must detect conflict between bgTest and themeEditor"
  );
  assert.ok(
    js.includes("Ignoring both special modes"),
    "Runtime should warn when both special modes are provided"
  );
});

test("runtime script skips non-background UI setup in bgTest mode", () => {
  const js = read("assets/app.js");
  assert.match(
    js,
    /if\s*\(\s*!backgroundTestMode\s*\)\s*\{[\s\S]*setupMapInteractions\(engine\);[\s\S]*setYear\(\);[\s\S]*\}/,
    "bgTest mode must guard non-background UI setup"
  );
  assert.ok(
    js.includes("onIntroComplete(() =>") && js.includes("animateCounters()"),
    "Counter animation should be deferred until intro completion event"
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

test("runtime script includes theme editor panel and save-to-file export", () => {
  const js = read("assets/app.js");
  assert.ok(js.includes("theme-editor-controls"), "Theme editor panel id must exist in runtime");
  assert.ok(js.includes("Save Theme File"), "Theme editor must include save button");
  assert.ok(js.includes("data-action=\"theme-dark\""), "Theme editor should include Dark theme action");
  assert.ok(js.includes("data-action=\"theme-light\""), "Theme editor should include Light theme action");
  assert.ok(js.includes("theme-editor-color-combo"), "Theme editor should include combined picker+text color controls");
  assert.ok(js.includes("Grid Color"), "Theme editor should expose Grid Color control");
  assert.ok(js.includes("Components"), "Theme editor should expose Components tab");
  assert.ok(js.includes("Canvas"), "Theme editor should expose Canvas tab");
  assert.ok(js.includes("new Blob"), "Theme export must create Blob");
  assert.ok(js.includes("download"), "Theme export must trigger download");
});

test("styles keep color literals only in theme token definitions", () => {
  const css = read("assets/styles.css");
  const rootMatch = css.match(/:root\s*\{[\s\S]*?\n\}/);
  assert.ok(rootMatch, "styles.css must contain :root token block");
  const cssWithoutRoot = css.replace(rootMatch[0], "");
  const literals = [...cssWithoutRoot.matchAll(/#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|rgb\([^)]*\)/g)]
    .map((match) => match[0])
    .filter((value) => !value.includes("var(") && value !== "transparent");
  assert.deepEqual(
    literals,
    [],
    `Expected no hardcoded color literals outside :root, found: ${literals.join(", ")}`
  );
});

test("route gradient stops are token-driven", () => {
  const html = read("index.html");
  const css = read("assets/styles.css");
  assert.ok(html.includes("route-gradient-stop-start"), "Route gradient start stop class is required");
  assert.ok(html.includes("route-gradient-stop-end"), "Route gradient end stop class is required");
  assert.ok(css.includes("var(--route-gradient-start)"), "Route gradient start must use token");
  assert.ok(css.includes("var(--route-gradient-end)"), "Route gradient end must use token");
});

test("runtime script includes appearance and group interaction debug keys", () => {
  const js = read("assets/app.js");
  assert.ok(js.includes("boundPointColor"), "Appearance key boundPointColor is required");
  assert.ok(js.includes("gridOpacity"), "Appearance key gridOpacity is required");
  assert.ok(js.includes("holdMs"), "Animation timing key holdMs is required");
  assert.ok(js.includes("crumbleMs"), "Animation timing key crumbleMs is required");
  assert.ok(js.includes("rebuildMs"), "Animation timing key rebuildMs is required");
  assert.ok(js.includes("boundBoundStrength"), "Group interaction key boundBoundStrength is required");
  assert.ok(js.includes("freeBoundGateScale"), "Group interaction key freeBoundGateScale is required");
  assert.ok(js.includes("clusterAdjacencySpan"), "Group interaction key clusterAdjacencySpan is required");
});

test("runtime script persists bgTest settings and avoids URL-sync", () => {
  const js = read("assets/app.js");
  assert.ok(
    js.includes("localStorage"),
    "bgTest controls must persist settings to localStorage"
  );
  assert.ok(
    js.includes("getItem") && js.includes("setItem"),
    "bgTest controls must read/write last state"
  );
  assert.ok(
    js.includes("bgTestControls:lastState:v1"),
    "bgTest controls should use a stable storage key"
  );
  assert.ok(
    !js.includes("sessionStorage"),
    "bgTest controls should not use sessionStorage"
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

test("styles include full-page theme editor mode and controls", () => {
  const css = read("assets/styles.css");
  assert.ok(css.includes("body.is-theme-editor"), "Theme editor body state is required");
  assert.ok(css.includes("#theme-editor-controls"), "Theme editor panel styles are required");
  assert.ok(css.includes(".theme-editor-color-combo"), "Theme editor should style combined picker+text rows");
  assert.ok(css.includes(".theme-editor-color-value"), "Theme editor must style text input for hex colors");
  assert.ok(
    !/body\.is-theme-editor\s+\.site-header[\s\S]*display:\s*none/.test(css) &&
      !/body\.is-theme-editor\s+main[\s\S]*display:\s*none/.test(css) &&
      !/body\.is-theme-editor\s+\.site-footer[\s\S]*display:\s*none/.test(css),
    "Theme editor mode must not hide page foreground sections"
  );
});
