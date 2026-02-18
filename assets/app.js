import {
  buildBridgeTemplateDetailed,
  buildIndustrialTemplateDetailed,
} from "./background-templates.js";
import {
  loadTemplateManifest,
  loadSvgTemplate,
  downsampleTemplateForProfile,
} from "./vector-template-loader.js";

const canvas = document.getElementById("bg-canvas");
const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)");
const INTRO_COMPLETE_EVENT = "logistruct:intro-complete";
const INTRO_SCROLL_LOCK_CLASS = "is-intro-scroll-lock";
const INTRO_MOBILE_SKIP_CLASS = "is-intro-mobile-nav-skip";
const INTRO_CONTENT_REVEAL_CLASS = "is-intro-content-reveal";
const INTRO_MOBILE_BREAKPOINT_QUERY = "(max-width: 760px)";
const INTRO_BRAND_CENTER_SCALE = 2;
const INTRO_BRAND_MOVE_EASING = "cubic-bezier(0.22, 0.61, 0.36, 1)";
const INTRO_PHASES = {
  IDLE: "idle",
  HOLD: "hold",
  MOVE: "move",
  NAV: "nav",
  REVEAL: "reveal",
  DONE: "done",
  SKIP: "skip",
  REDUCED: "reduced",
};
const INTRO_TIMINGS = {
  full: {
    holdMs: 1700,
    moveMs: 1300,
    navMs: 700,
    revealMs: 700,
    failSafeMs: 6400,
  },
  short: {
    holdMs: 1000,
    moveMs: 850,
    navMs: 420,
    revealMs: 520,
    failSafeMs: 4400,
  },
  reduced: {
    totalMs: 400,
    failSafeMs: 1200,
  },
};
let introCompletionSnapshot = null;

function isBackgroundTestMode(searchParams = new URLSearchParams(window.location.search)) {
  return searchParams.get("bgTest") === "1";
}

function isThemeEditorMode(searchParams = new URLSearchParams(window.location.search)) {
  return searchParams.get("themeEditor") === "1";
}

function getThemeParamName(searchParams = new URLSearchParams(window.location.search)) {
  const raw = (searchParams.get("theme") || "").trim().toLowerCase();
  if (!raw) return null;
  if (!/^[a-z0-9_-]+$/.test(raw)) return null;
  return raw;
}

function applyBackgroundTestMode(enabled) {
  if (!document.body) return;
  document.body.classList.toggle("is-bg-test", enabled);
}

function applyThemeEditorMode(enabled) {
  if (!document.body) return;
  document.body.classList.toggle("is-theme-editor", enabled);
}

function cloneDeep(value) {
  return JSON.parse(JSON.stringify(value));
}

function waitForMs(ms = 0) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, Math.max(0, Math.round(ms)));
  });
}

function waitForNextFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function waitForIntroFonts(maxWaitMs = 450) {
  const fontSet = document.fonts;
  if (!fontSet || !fontSet.ready) return;
  await Promise.race([
    Promise.resolve(fontSet.ready).catch(() => undefined),
    waitForMs(maxWaitMs),
  ]);
}

function setIntroPhase(phase) {
  if (!document.body) return;
  document.body.setAttribute("data-intro-phase", phase);
}

function getIntroPhase() {
  if (!document.body) return INTRO_PHASES.IDLE;
  return document.body.getAttribute("data-intro-phase") || INTRO_PHASES.IDLE;
}

function emitIntroComplete(detail = {}) {
  const payload = {
    phase: detail.phase || getIntroPhase(),
    reason: detail.reason || "unknown",
    timestampMs: performance.now(),
  };
  introCompletionSnapshot = payload;
  window.dispatchEvent(
    new CustomEvent(INTRO_COMPLETE_EVENT, {
      detail: payload,
    })
  );
  return payload;
}

function onIntroComplete(callback) {
  if (typeof callback !== "function") return;
  if (introCompletionSnapshot) {
    callback(introCompletionSnapshot);
    return;
  }
  window.addEventListener(
    INTRO_COMPLETE_EVENT,
    (event) => {
      callback(event.detail || null);
    },
    { once: true }
  );
}

function selectIntroMode() {
  if (prefersReduced.matches) return "reduced";

  const profile = getMotionProfile();
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const isConstrainedConnection = Boolean(
    connection &&
      (connection.saveData || /(^|-)2g$/i.test(String(connection.effectiveType || "")))
  );

  if (profile === "low" || isConstrainedConnection) return "short";
  return "full";
}

function buildBrandCenterTransform(brandTextEl, centerScale = INTRO_BRAND_CENTER_SCALE) {
  if (!brandTextEl) return null;
  const targetRect = brandTextEl.getBoundingClientRect();
  if (!targetRect.width || !targetRect.height) return null;

  const viewportCenterX = window.innerWidth / 2;
  const viewportCenterY = window.innerHeight / 2;
  const targetCenterX = targetRect.left + targetRect.width / 2;
  const targetCenterY = targetRect.top + targetRect.height / 2;
  const dx = viewportCenterX - targetCenterX;
  const dy = viewportCenterY - targetCenterY;
  const scale = clamp(Number(centerScale) || INTRO_BRAND_CENTER_SCALE, 1, 3.5);
  return `translate3d(${dx}px, ${dy}px, 0) scale(${scale})`;
}

function applyBrandIntroStartState(brandTextEl, centerScale = INTRO_BRAND_CENTER_SCALE) {
  if (!brandTextEl) return false;
  const startTransform = buildBrandCenterTransform(brandTextEl, centerScale);
  if (!startTransform) return false;
  brandTextEl.style.transition = "none";
  brandTextEl.style.transformOrigin = "center center";
  brandTextEl.style.willChange = "transform";
  brandTextEl.style.transform = startTransform;
  void brandTextEl.getBoundingClientRect();
  return true;
}

function clearBrandInlineIntroState(brandTextEl) {
  if (!brandTextEl) return;
  brandTextEl.style.removeProperty("transform");
  brandTextEl.style.removeProperty("transition");
  brandTextEl.style.removeProperty("will-change");
  brandTextEl.style.removeProperty("transform-origin");
}

async function runIntroSequence({ backgroundTestMode = false, themeEditorMode = false } = {}) {
  if (!document.body) {
    return emitIntroComplete({
      phase: INTRO_PHASES.SKIP,
      reason: "missing-body",
    });
  }

  const brandText = document.querySelector(".brand-text");
  const shouldSkipIntro = backgroundTestMode || themeEditorMode || !brandText;

  if (shouldSkipIntro) {
    document.body.classList.remove(INTRO_SCROLL_LOCK_CLASS);
    document.body.classList.remove(INTRO_MOBILE_SKIP_CLASS);
    document.body.classList.remove(INTRO_CONTENT_REVEAL_CLASS);
    clearBrandInlineIntroState(brandText);
    setIntroPhase(INTRO_PHASES.SKIP);
    return emitIntroComplete({
      phase: INTRO_PHASES.SKIP,
      reason: "backgroundTestMode || themeEditorMode || missing-brand-text",
    });
  }

  let isCompleted = false;
  let failSafeTimer = 0;
  const complete = (
    phase = INTRO_PHASES.DONE,
    reason = "normal",
    { preserveNavSkip = false } = {}
  ) => {
    if (isCompleted) return introCompletionSnapshot;
    isCompleted = true;
    if (failSafeTimer) window.clearTimeout(failSafeTimer);
    if (preserveNavSkip) {
      document.body.classList.add(INTRO_MOBILE_SKIP_CLASS);
    }
    setIntroPhase(phase);
    clearBrandInlineIntroState(brandText);
    document.body.classList.remove(INTRO_SCROLL_LOCK_CLASS);
    document.body.classList.remove(INTRO_CONTENT_REVEAL_CLASS);
    if (preserveNavSkip) {
      window.setTimeout(() => {
        if (!document.body) return;
        document.body.classList.remove(INTRO_MOBILE_SKIP_CLASS);
      }, 30);
    } else {
      document.body.classList.remove(INTRO_MOBILE_SKIP_CLASS);
    }
    return emitIntroComplete({ phase, reason });
  };

  try {
    const mode = selectIntroMode();
    const skipDesktopNavExpand = window.matchMedia(INTRO_MOBILE_BREAKPOINT_QUERY).matches;
    clearBrandInlineIntroState(brandText);
    document.body.classList.add(INTRO_SCROLL_LOCK_CLASS);
    document.body.classList.toggle(INTRO_MOBILE_SKIP_CLASS, skipDesktopNavExpand);
    document.body.classList.remove(INTRO_CONTENT_REVEAL_CLASS);

    if (mode === "reduced") {
      setIntroPhase(INTRO_PHASES.REDUCED);
      failSafeTimer = window.setTimeout(
        () => void complete(INTRO_PHASES.DONE, "reduced-fail-safe", { preserveNavSkip: true }),
        INTRO_TIMINGS.reduced.failSafeMs
      );
      await waitForMs(INTRO_TIMINGS.reduced.totalMs);
      return complete(INTRO_PHASES.DONE, "reduced", { preserveNavSkip: true });
    }

    const timing = mode === "short" ? INTRO_TIMINGS.short : INTRO_TIMINGS.full;
    failSafeTimer = window.setTimeout(
      () => void complete(INTRO_PHASES.DONE, "fail-safe"),
      timing.failSafeMs
    );

    await waitForIntroFonts();
    if (!applyBrandIntroStartState(brandText, INTRO_BRAND_CENTER_SCALE)) {
      return complete(INTRO_PHASES.DONE, "missing-brand-geometry");
    }
    setIntroPhase(INTRO_PHASES.HOLD);
    await waitForNextFrame();
    await waitForMs(timing.holdMs);

    setIntroPhase(INTRO_PHASES.MOVE);
    await waitForNextFrame();
    brandText.style.transition = `transform ${timing.moveMs}ms ${INTRO_BRAND_MOVE_EASING}`;
    brandText.style.transform = "translate3d(0, 0, 0) scale(1)";
    await waitForMs(timing.moveMs);

    setIntroPhase(INTRO_PHASES.NAV);
    await waitForMs(skipDesktopNavExpand ? 0 : timing.navMs);

    setIntroPhase(INTRO_PHASES.REVEAL);
    document.body.classList.add(INTRO_CONTENT_REVEAL_CLASS);
    await waitForMs(timing.revealMs);

    return complete(INTRO_PHASES.DONE, mode === "short" ? "adaptive-short" : "full");
  } catch (error) {
    console.warn("[intro] sequence failed, applying fail-safe:", error);
    return complete(INTRO_PHASES.DONE, "error-fail-safe");
  }
}

const profileConfig = {
  high: {
    particleCount: 124,
    linkDistance: 132,
    driftSpeed: 0.16,
    fps: 60,
    spring: 0.018,
    damping: 0.92,
    noise: 0.08,
    maxLinksPerParticle: 7,
  },
  medium: {
    particleCount: 96,
    linkDistance: 122,
    driftSpeed: 0.14,
    fps: 50,
    spring: 0.015,
    damping: 0.93,
    noise: 0.07,
    maxLinksPerParticle: 6,
  },
  low: {
    particleCount: 62,
    linkDistance: 110,
    driftSpeed: 0.11,
    fps: 35,
    spring: 0.012,
    damping: 0.94,
    noise: 0.05,
    maxLinksPerParticle: 4,
  },
  reduced: {
    particleCount: 40,
    linkDistance: 92,
    driftSpeed: 0.035,
    fps: 14,
    spring: 0.008,
    damping: 0.965,
    noise: 0.015,
    maxLinksPerParticle: 3,
  },
};

const engineConfig = {
  phase: {
    cycleMs: 24000,
    crumbleMs: 4000,
    rebuildMs: 6000,
    holdMs: 14000,
  },
  structureMode: {
    enabled: true,
    renderMode: "topology_hybrid",
    reactionRadiusPx: 220,
    maxLinksPerParticle: 6,
    alphaCap: 0.24,
    topologyEdgeCapByProfile: {
      high: 170,
      medium: 132,
      low: 90,
      reduced: 56,
    },
    sampling: {
      sampleStepPxByProfile: {
        high: 10,
        medium: 11,
        low: 13,
        reduced: 14,
      },
      minLayerShare: {
        foundation: 0.15,
        supports: 0.2,
        beams: 0.22,
        truss: 0.1,
        braces: 0.12,
        roof: 0.1,
      },
      preserveConnectivity: true,
      stitchingEnabled: true,
      stitchMaxEdgesByProfile: {
        high: 4,
        medium: 3,
        low: 2,
        reduced: 1,
      },
      stitchMaxDistanceNxyByProfile: {
        high: 0.09,
        medium: 0.085,
        low: 0.08,
        reduced: 0.075,
      },
    },
    freeParticles: {
      ratioByProfile: {
        high: 0.3,
        medium: 0.25,
        low: 0.18,
        reduced: 0.2,
      },
      weakLinkDistance: 96,
      weakAlphaCap: 0.09,
    },
  },
};

const REQUIRED_LAYERS = {
  bridge: ["foundation", "supports", "beams", "truss", "braces"],
  industrial_frame: ["foundation", "supports", "beams", "braces", "roof"],
};

const projectFocusMap = {
  "steel-hub": { nx: 0.28, ny: 0.63 },
  "river-terminal": { nx: 0.58, ny: 0.6 },
  "grain-corridor": { nx: 0.8, ny: 0.41 },
};

const CORE_LAYERS = new Set(["foundation", "supports", "beams"]);
const SECONDARY_LAYERS = new Set(["truss", "braces"]);
const DENSITY_TARGET_SCALE = [1, 0.9, 0.78, 0.64];
const DENSITY_STEP_BONUS = [0, 0, 1, 2];

const REBUILD_WAVE_WINDOWS = {
  foundation: [0.05, 0.25],
  supports: [0.2, 0.5],
  beams: [0.4, 0.78],
  truss: [0.4, 0.78],
  roof: [0.4, 0.78],
  braces: [0.62, 0.95],
};

const DEFAULT_DEBUG_VISUAL_STATE = {
  boundPointColor: "#b8e7f4",
  freePointColor: "#93c1d3",
  topologyLinkColor: "#65b9d2",
  freeLinkColor: "#7aadc0",
  crossLinkColor: "#6aa5ba",
  gradientStartColor: "#2bd2bb",
  gradientEndColor: "#ffcf66",
  gridColor: "#ffffff",
  pointSizeScale: 1,
  linkWidthPx: 1,
  gridOpacity: 0.46,
  gridSizePx: 34,
  gradientAlphaScale: 1,
};

const DEFAULT_DEBUG_INTERACTION_STATE = {
  boundBoundStrength: 1,
  freeFreeStrength: 1,
  freeBoundStrength: 1,
  freeBoundGateScale: 1,
  clusterAdjacencySpan: 1,
};

const BG_TEST_STORAGE_KEY = "bgTestControls:lastState:v1";
const THEME_FILE_VERSION = 1;
const THEME_TOKENS_APPLIED_EVENT = "logistruct:theme-tokens-applied";
const THEME_TOKEN_KEYS = [
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
const THEME_HEX_KEYS = [
  "--bg",
  "--bg-soft",
  "--bg-radial-start",
  "--bg-radial-end",
  "--text",
  "--text-dim",
  "--accent",
  "--accent-warm",
  "--danger",
  "--btn-primary-mid",
  "--btn-primary-end",
  "--btn-primary-text",
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
const THEME_TEXT_COLOR_KEYS = [
  "--surface",
  "--surface-strong",
  "--line",
  "--control-panel-border",
  "--control-panel-bg",
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
  "--btn-ghost-border",
  "--btn-ghost-bg",
  "--card-active-border",
  "--map-shell-bg",
  "--map-bg-fill",
  "--map-region-fill",
  "--map-region-stroke",
  "--map-node-pulse-fill",
  "--map-node-pulse-stroke",
];
const THEME_TEXT_VALUE_KEYS = ["--shadow", "--control-panel-shadow", "--btn-primary-shadow"];

function readThemeTokensFromRoot() {
  const style = window.getComputedStyle(document.documentElement);
  const tokens = {};
  THEME_TOKEN_KEYS.forEach((key) => {
    tokens[key] = style.getPropertyValue(key).trim();
  });
  return tokens;
}

function normalizeGridRgb(value, fallback = "255 255 255") {
  const parts = String(value || "")
    .replaceAll(",", " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return fallback;
  return parts.map((part) => String(Math.max(0, Math.min(255, Math.round(part))))).join(" ");
}

function normalizeGridOpacity(value, fallback = "0.46") {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return String(clamp(number, 0, 1));
}

function normalizeGridSize(value, fallback = "34px") {
  const raw = String(value || "").trim().toLowerCase();
  const parsed = /^([0-9]+(?:\.[0-9]+)?)px$/.exec(raw);
  const base = parsed ? Number(parsed[1]) : Number(raw);
  if (!Number.isFinite(base)) return fallback;
  return `${Math.round(clamp(base, 12, 120))}px`;
}

function normalizeThemeTokenValue(key, value, fallbackValue) {
  if (THEME_HEX_KEYS.includes(key)) {
    return normalizeHexColor(String(value || ""), normalizeHexColor(String(fallbackValue || "#ffffff")));
  }
  if (THEME_TEXT_COLOR_KEYS.includes(key)) {
    const text = String(value || "").trim();
    return text || String(fallbackValue || "");
  }
  if (THEME_TEXT_VALUE_KEYS.includes(key)) {
    const text = String(value || "").trim();
    return text || String(fallbackValue || "");
  }
  if (key === "--bg-grid-rgb") return normalizeGridRgb(value, String(fallbackValue || "255 255 255"));
  if (key === "--bg-grid-opacity") return normalizeGridOpacity(value, String(fallbackValue || "0.46"));
  if (key === "--bg-grid-size") return normalizeGridSize(value, String(fallbackValue || "34px"));
  return String(value || "").trim() || String(fallbackValue || "");
}

function sanitizeThemeTokens(inputTokens = {}, fallbackTokens = {}) {
  const next = {};
  THEME_TOKEN_KEYS.forEach((key) => {
    const fallbackValue = fallbackTokens[key] || "";
    if (!(key in inputTokens)) {
      next[key] = String(fallbackValue);
      return;
    }
    next[key] = normalizeThemeTokenValue(key, inputTokens[key], fallbackValue);
  });
  return next;
}

function applyThemeTokens(tokens = {}) {
  const fallbackTokens = readThemeTokensFromRoot();
  const sanitized = sanitizeThemeTokens(tokens, fallbackTokens);
  const root = document.documentElement;
  Object.entries(sanitized).forEach(([key, value]) => {
    root.style.setProperty(key, String(value));
  });
  window.dispatchEvent(
    new CustomEvent(THEME_TOKENS_APPLIED_EVENT, {
      detail: { tokens: sanitized },
    })
  );
  return sanitized;
}

function parseThemeDocument(payload, fallbackTokens) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if (payload.version !== THEME_FILE_VERSION) return null;
  if (!payload.tokens || typeof payload.tokens !== "object" || Array.isArray(payload.tokens)) return null;
  const name =
    typeof payload.name === "string" && payload.name.trim()
      ? payload.name.trim()
      : "custom";
  return {
    version: THEME_FILE_VERSION,
    name,
    tokens: sanitizeThemeTokens(payload.tokens, fallbackTokens),
  };
}

async function loadThemeFromFile(themeName, fallbackTokens) {
  if (!themeName) return null;
  if (!/^[a-z0-9_-]+$/.test(themeName)) return null;

  const sourcePath = `assets/themes/${themeName}.json`;
  try {
    const response = await fetch(sourcePath);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const parsed = parseThemeDocument(payload, fallbackTokens);
    if (!parsed) throw new Error("Invalid theme document");
    applyThemeTokens(parsed.tokens);
    return parsed;
  } catch (error) {
    console.warn(`[theme-editor] failed to load ${sourcePath}:`, error);
    return null;
  }
}

function getMotionProfile() {
  if (prefersReduced.matches) return "reduced";
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  if (cores >= 8 && memory >= 8) return "high";
  if (cores >= 6 && memory >= 4) return "medium";
  return "low";
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function normalizeHexColor(value, fallback = "#ffffff") {
  const fallbackNorm = /^#([0-9a-f]{6})$/i.test(fallback) ? fallback.toLowerCase() : "#ffffff";
  if (typeof value !== "string") return fallbackNorm;
  const raw = value.trim();
  const short = /^#([0-9a-f]{3})$/i.exec(raw);
  if (short) {
    const [r, g, b] = short[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const full = /^#([0-9a-f]{6})$/i.exec(raw);
  if (full) return `#${full[1].toLowerCase()}`;
  return fallbackNorm;
}

function hexToRgbTuple(hexColor, fallback = "#ffffff") {
  const hex = normalizeHexColor(hexColor, fallback).slice(1);
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function hexToRgbComma(hexColor, fallback = "#ffffff") {
  const [r, g, b] = hexToRgbTuple(hexColor, fallback);
  return `${r}, ${g}, ${b}`;
}

function hexToRgbSpace(hexColor, fallback = "#ffffff") {
  const [r, g, b] = hexToRgbTuple(hexColor, fallback);
  return `${r} ${g} ${b}`;
}

function rgbTupleToHex(r, g, b) {
  const clampChannel = (value) => Math.round(clamp(Number(value), 0, 255));
  const toHex = (value) => clampChannel(value).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function parseColorLikeToHex(value, fallback = "#ffffff") {
  const fallbackHex = normalizeHexColor(fallback, "#ffffff");
  if (typeof value !== "string") return fallbackHex;
  const raw = value.trim();
  if (!raw) return fallbackHex;
  if (raw.startsWith("#")) return normalizeHexColor(raw, fallbackHex);

  const rgbaMatch = /^rgba?\(\s*([0-9]{1,3}(?:\.[0-9]+)?)\s*[, ]\s*([0-9]{1,3}(?:\.[0-9]+)?)\s*[, ]\s*([0-9]{1,3}(?:\.[0-9]+)?)(?:\s*[,/]\s*([0-9]*\.?[0-9]+)\s*)?\)$/i.exec(
    raw
  );
  if (rgbaMatch) {
    return rgbTupleToHex(
      Number(rgbaMatch[1]),
      Number(rgbaMatch[2]),
      Number(rgbaMatch[3])
    );
  }

  const parts = raw
    .replaceAll(",", " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => Number(part));
  if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
    return rgbTupleToHex(parts[0], parts[1], parts[2]);
  }

  return fallbackHex;
}

function readRgbaAlpha(value, fallback = 1) {
  if (typeof value !== "string") return clamp(Number(fallback) || 1, 0, 1);
  const raw = value.trim();
  const rgbaMatch = /^rgba?\(\s*([0-9]{1,3}(?:\.[0-9]+)?)\s*[, ]\s*([0-9]{1,3}(?:\.[0-9]+)?)\s*[, ]\s*([0-9]{1,3}(?:\.[0-9]+)?)(?:\s*[,/]\s*([0-9]*\.?[0-9]+)\s*)?\)$/i.exec(
    raw
  );
  if (!rgbaMatch) return clamp(Number(fallback) || 1, 0, 1);
  if (rgbaMatch[4] == null) return 1;
  const alpha = Number(rgbaMatch[4]);
  if (!Number.isFinite(alpha)) return clamp(Number(fallback) || 1, 0, 1);
  return clamp(alpha, 0, 1);
}

function composeRgbaFromHex(hexColor, alpha = 1) {
  const [r, g, b] = hexToRgbTuple(hexColor, "#ffffff");
  const safeAlpha = clamp(Number(alpha) || 1, 0, 1);
  const alphaText = safeAlpha.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return `rgba(${r}, ${g}, ${b}, ${alphaText})`;
}

function readBackgroundTestState() {
  try {
    const raw = window.localStorage.getItem(BG_TEST_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeBackgroundTestState(state) {
  try {
    if (!state || typeof state !== "object") return;
    window.localStorage.setItem(BG_TEST_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures in restricted browser contexts.
  }
}

function easeInOutSine(t) {
  return -(Math.cos(Math.PI * clamp(t, 0, 1)) - 1) / 2;
}

function shuffle(array) {
  const copy = array.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function clusterFromX(x) {
  const nx = x / Math.max(window.innerWidth, 1);
  if (nx < 0.2) return "0";
  if (nx < 0.4) return "1";
  if (nx < 0.6) return "2";
  if (nx < 0.8) return "3";
  return "4";
}

function isClusterAdjacent(a, b, span = 1) {
  return Math.abs(Number(a) - Number(b)) <= Math.max(0, Math.floor(span));
}

function hashPair(a, b) {
  const text = `${a}|${b}`;
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function buildStageForLayer(layer) {
  if (layer === "foundation") return 0;
  if (layer === "supports") return 1;
  if (layer === "braces") return 3;
  return 2;
}

function getWaveWindow(layer) {
  return REBUILD_WAVE_WINDOWS[layer] || REBUILD_WAVE_WINDOWS.beams;
}

function validateTemplateLayers(template, templateId) {
  const required = REQUIRED_LAYERS[templateId] || [];
  const available = new Set(template.points.map((point) => point.layer));
  required.forEach((layer) => {
    if (!available.has(layer)) throw new Error(`Template ${templateId} missing layer ${layer}`);
  });
}

function createFallbackTemplates() {
  return {
    bridge: buildBridgeTemplateDetailed(),
    industrial_frame: buildIndustrialTemplateDetailed(),
  };
}

async function loadVectorTemplatesWithFallback() {
  const fallback = createFallbackTemplates();
  const templates = { ...fallback };

  try {
    const manifest = await loadTemplateManifest("assets/structures/index.json");
    for (const item of manifest.templates) {
      try {
        const parsed = await loadSvgTemplate(item, {
          sampleStepPx: engineConfig.structureMode.sampling.sampleStepPxByProfile.high,
        });
        validateTemplateLayers(parsed, item.id);
        templates[item.id] = parsed;
      } catch (error) {
        console.warn(`[vector-template-loader] fallback for ${item.id}:`, error);
        templates[item.id] = fallback[item.fallbackId] || fallback[item.id];
      }
    }
  } catch (error) {
    console.warn("[vector-template-loader] manifest load failed, using fallback:", error);
  }

  return templates;
}

function createNoopEngine() {
  return {
    setQuality() {},
    setFocus() {},
    applyDebugOverrides() {},
    applyDebugPreset() {},
    resetDebugOverrides() {},
    getDebugState() {
      return null;
    },
    isPaused() {
      return true;
    },
    pause() {},
    resume() {},
    destroy() {},
  };
}

function initBackground(canvasEl, config, initialTemplates) {
  if (!canvasEl) return createNoopEngine();
  const context = canvasEl.getContext("2d");
  if (!context) return createNoopEngine();
  let templates = { ...initialTemplates };
  let templateOrder = Object.keys(templates).filter((id) => templates[id]);
  if (templateOrder.length < 2) {
    const fallback = createFallbackTemplates();
    templates = { ...fallback, ...templates };
    templateOrder = Object.keys(templates);
  }

  let profile = getMotionProfile();
  let running = true;
  let rafId = 0;
  let lastFrameTime = 0;
  let particles = [];

  const densityState = {
    stage: 0,
    overBudgetFrames: 0,
    underBudgetFrames: 0,
  };

  const phaseState = {
    phase: "hold",
    phaseStartedMs: performance.now(),
    phaseProgress: 0,
    crumbleOriginX: window.innerWidth * 0.5,
    crumbleOriginY: window.innerHeight * 0.5,
  };

  const structureState = {
    activeTemplateId: templateOrder[0],
    nextTemplateId: templateOrder[1] || templateOrder[0],
    activeTemplate: null,
    nextTemplate: null,
    anchors: [],
    anchorById: new Map(),
    topologyEdges: [],
    nextAnchors: [],
    nextAnchorById: new Map(),
    nextTopologyEdges: [],
  };

  const focusState = {
    projectId: null,
    x: window.innerWidth * 0.5,
    y: window.innerHeight * 0.5,
    targetX: window.innerWidth * 0.5,
    targetY: window.innerHeight * 0.5,
    strength: 0,
    targetStrength: 0,
  };
  const defaultProfileState = cloneDeep(profileConfig);
  const defaultStructureState = cloneDeep(config.structureMode);
  const defaultPhaseState = cloneDeep(config.phase);
  const defaultVisualState = cloneDeep(DEFAULT_DEBUG_VISUAL_STATE);
  const defaultInteractionState = cloneDeep(DEFAULT_DEBUG_INTERACTION_STATE);
  const debugVisualState = cloneDeep(DEFAULT_DEBUG_VISUAL_STATE);
  const debugInteractionState = cloneDeep(DEFAULT_DEBUG_INTERACTION_STATE);

  function syncVisualStateFromThemeTokens(inputTokens = readThemeTokensFromRoot()) {
    const tokens = sanitizeThemeTokens(inputTokens, readThemeTokensFromRoot());
    debugVisualState.boundPointColor = normalizeHexColor(
      tokens["--canvas-bound-point"],
      defaultVisualState.boundPointColor
    );
    debugVisualState.freePointColor = normalizeHexColor(
      tokens["--canvas-free-point"],
      defaultVisualState.freePointColor
    );
    debugVisualState.topologyLinkColor = normalizeHexColor(
      tokens["--canvas-topology-link"],
      defaultVisualState.topologyLinkColor
    );
    debugVisualState.freeLinkColor = normalizeHexColor(
      tokens["--canvas-free-link"],
      defaultVisualState.freeLinkColor
    );
    debugVisualState.crossLinkColor = normalizeHexColor(
      tokens["--canvas-cross-link"],
      defaultVisualState.crossLinkColor
    );
    debugVisualState.gradientStartColor = normalizeHexColor(
      tokens["--canvas-gradient-start"],
      defaultVisualState.gradientStartColor
    );
    debugVisualState.gradientEndColor = normalizeHexColor(
      tokens["--canvas-gradient-end"],
      defaultVisualState.gradientEndColor
    );
    debugVisualState.gridColor = parseColorLikeToHex(
      tokens["--bg-grid-rgb"],
      defaultVisualState.gridColor
    );

    const gridOpacity = Number(tokens["--bg-grid-opacity"]);
    debugVisualState.gridOpacity = Number.isFinite(gridOpacity)
      ? clamp(gridOpacity, 0, 1)
      : defaultVisualState.gridOpacity;
    const gridSize = Number(String(tokens["--bg-grid-size"] || "").replace("px", ""));
    debugVisualState.gridSizePx = Number.isFinite(gridSize)
      ? clamp(gridSize, 12, 96)
      : defaultVisualState.gridSizePx;
  }

  function applyGridDebugVars() {
    const root = document.documentElement;
    root.style.setProperty("--bg-grid-rgb", hexToRgbSpace(debugVisualState.gridColor, "#ffffff"));
    root.style.setProperty("--bg-grid-opacity", String(clamp(debugVisualState.gridOpacity, 0, 1)));
    root.style.setProperty(
      "--bg-grid-size",
      `${Math.round(clamp(debugVisualState.gridSizePx, 12, 96))}px`
    );
  }

  function handleThemeTokensApplied(event) {
    const nextTokens =
      event?.detail?.tokens && typeof event.detail.tokens === "object"
        ? event.detail.tokens
        : readThemeTokensFromRoot();
    syncVisualStateFromThemeTokens(nextTokens);
    Object.assign(defaultVisualState, cloneDeep(debugVisualState));
    applyGridDebugVars();
  }

  function lineWidthWithScale() {
    return clamp(debugVisualState.linkWidthPx, 0.4, 3);
  }

  function nextTemplateId(currentId) {
    const index = templateOrder.indexOf(currentId);
    if (index < 0) return templateOrder[0];
    return templateOrder[(index + 1) % templateOrder.length];
  }

  function getBoundTargetCount(targetProfile, densityStage) {
    const cfg = profileConfig[targetProfile];
    const freeRatio = config.structureMode.freeParticles.ratioByProfile[targetProfile] ?? 0.2;
    const stageScale = DENSITY_TARGET_SCALE[densityStage] ?? 1;
    return Math.max(16, Math.round(cfg.particleCount * (1 - freeRatio) * stageScale));
  }

  function sampleTemplate(templateId, densityStage) {
    const template = templates[templateId];
    if (!template) return null;
    const sampling = config.structureMode.sampling;
    const profileStep = sampling.sampleStepPxByProfile[profile] || 12;
    const stepBonus = DENSITY_STEP_BONUS[densityStage] || 0;

    return downsampleTemplateForProfile(template, profile, {
      ...sampling,
      targetPointCount: getBoundTargetCount(profile, densityStage),
      sampleStepPxByProfile: {
        ...sampling.sampleStepPxByProfile,
        [profile]: profileStep + stepBonus,
      },
    });
  }

  function densityAllowsAnchor(anchor, index, densityStage) {
    if (densityStage >= 2 && !CORE_LAYERS.has(anchor.layer)) return false;
    if (densityStage >= 3 && index % 2 === 1) return false;
    return true;
  }

  function buildAnchorsForViewport(template, densityStage) {
    if (!template) return [];

    const padX = window.innerWidth * 0.08;
    const padY = window.innerHeight * 0.08;
    const usableWidth = Math.max(1, window.innerWidth - padX * 2);
    const usableHeight = Math.max(1, window.innerHeight - padY * 2);
    const anchors = [];

    template.points.forEach((point, index) => {
      if (!densityAllowsAnchor(point, index, densityStage)) return;
      anchors.push({
        ...point,
        x: padX + point.nx * usableWidth,
        y: padY + point.ny * usableHeight,
      });
    });

    return anchors;
  }

  function createAnchorIndex(anchors) {
    const map = new Map();
    anchors.forEach((anchor) => map.set(anchor.id, anchor));
    return map;
  }

  function buildTopologyEdges(template, anchorById, densityStage) {
    if (!template || !Array.isArray(template.lineHints)) return [];

    const dedupe = new Set();
    const edges = [];

    template.lineHints.forEach((hint) => {
      const fromAnchor = anchorById.get(hint.from);
      const toAnchor = anchorById.get(hint.to);
      if (!fromAnchor || !toAnchor) return;

      const layer = fromAnchor.layer === toAnchor.layer ? fromAnchor.layer : fromAnchor.layer;
      if (densityStage >= 2 && !CORE_LAYERS.has(layer)) return;
      if (densityStage >= 3 && hashPair(hint.from, hint.to) % 2 === 1) return;

      const key = hint.from < hint.to ? `${hint.from}|${hint.to}` : `${hint.to}|${hint.from}`;
      if (dedupe.has(key)) return;
      dedupe.add(key);

      edges.push({
        from: hint.from,
        to: hint.to,
        layer,
        strength: hint.strength || 0.8,
      });
    });

    edges.sort((a, b) => b.strength - a.strength);
    const capBase = config.structureMode.topologyEdgeCapByProfile[profile] || 120;
    const stageFactor = densityStage >= 3 ? 0.56 : densityStage === 2 ? 0.74 : 1;
    return edges.slice(0, Math.max(18, Math.floor(capBase * stageFactor)));
  }

  function rebuildAnchors() {
    structureState.activeTemplate = sampleTemplate(structureState.activeTemplateId, densityState.stage);
    structureState.nextTemplate = sampleTemplate(structureState.nextTemplateId, densityState.stage);

    structureState.anchors = buildAnchorsForViewport(structureState.activeTemplate, densityState.stage);
    structureState.anchorById = createAnchorIndex(structureState.anchors);
    structureState.topologyEdges = buildTopologyEdges(
      structureState.activeTemplate,
      structureState.anchorById,
      densityState.stage
    );

    structureState.nextAnchors = buildAnchorsForViewport(structureState.nextTemplate, densityState.stage);
    structureState.nextAnchorById = createAnchorIndex(structureState.nextAnchors);
    structureState.nextTopologyEdges = buildTopologyEdges(
      structureState.nextTemplate,
      structureState.nextAnchorById,
      densityState.stage
    );
  }

  function createParticles() {
    const cfg = profileConfig[profile];
    const freeRatio = config.structureMode.freeParticles.ratioByProfile[profile] ?? 0.2;
    const targetBoundCount = Math.round(cfg.particleCount * (1 - freeRatio));
    const boundCount = Math.min(targetBoundCount, structureState.anchors.length);
    const freeCount = Math.max(0, cfg.particleCount - boundCount);

    const nextParticles = [];
    const anchorGroups = new Map();
    structureState.anchors.forEach((anchor) => {
      const key = `${anchor.layer}:${anchor.semanticGroup || anchor.layer}`;
      if (!anchorGroups.has(key)) anchorGroups.set(key, []);
      anchorGroups.get(key).push(anchor);
    });
    const groupedAnchors = Array.from(anchorGroups.values()).map((group) =>
      group
        .slice()
        .sort((a, b) => {
          const ai = Number.isFinite(a.sourceIndex) ? a.sourceIndex : 0;
          const bi = Number.isFinite(b.sourceIndex) ? b.sourceIndex : 0;
          return ai - bi;
        })
    );
    const selectedAnchors = [];
    const used = new Set();
    while (selectedAnchors.length < boundCount) {
      let progressed = false;
      for (const group of groupedAnchors) {
        if (selectedAnchors.length >= boundCount) break;
        const anchor = group.find((candidate) => !used.has(candidate.id));
        if (!anchor) continue;
        used.add(anchor.id);
        selectedAnchors.push(anchor);
        progressed = true;
      }
      if (!progressed) break;
    }
    if (selectedAnchors.length < boundCount) {
      for (const anchor of structureState.anchors) {
        if (selectedAnchors.length >= boundCount) break;
        if (used.has(anchor.id)) continue;
        used.add(anchor.id);
        selectedAnchors.push(anchor);
      }
    }

    for (let i = 0; i < boundCount; i += 1) {
      const anchor = selectedAnchors[i % selectedAnchors.length];
      nextParticles.push({
        role: "bound",
        x: anchor.x + (Math.random() - 0.5) * 12,
        y: anchor.y + (Math.random() - 0.5) * 12,
        vx: (Math.random() - 0.5) * cfg.driftSpeed,
        vy: (Math.random() - 0.5) * cfg.driftSpeed,
        radius: 0.8 + Math.random() * 1.6,
        anchorId: anchor.id,
        rebuildTargetId: anchor.id,
        rebuildStage: buildStageForLayer(anchor.layer),
        assembleDelayJitter: (Math.random() - 0.5) * 0.08,
        cluster: anchor.cluster,
        layer: anchor.layer,
      });
    }

    for (let i = 0; i < freeCount; i += 1) {
      const x = Math.random() * window.innerWidth;
      const y = Math.random() * window.innerHeight;
      nextParticles.push({
        role: "free",
        x,
        y,
        vx: (Math.random() - 0.5) * cfg.driftSpeed * 1.3,
        vy: (Math.random() - 0.5) * cfg.driftSpeed * 1.3,
        radius: 0.6 + Math.random() * 1.15,
        anchorId: null,
        rebuildTargetId: null,
        rebuildStage: 0,
        assembleDelayJitter: 0,
        cluster: clusterFromX(x),
        layer: "free",
      });
    }

    particles = nextParticles;
  }

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvasEl.width = Math.floor(window.innerWidth * dpr);
    canvasEl.height = Math.floor(window.innerHeight * dpr);
    canvasEl.style.width = `${window.innerWidth}px`;
    canvasEl.style.height = `${window.innerHeight}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function setPhase(nextPhase, nowMs) {
    phaseState.phase = nextPhase;
    phaseState.phaseStartedMs = nowMs;
    phaseState.phaseProgress = 0;
  }

  function getBoundParticles() {
    return particles.filter((particle) => particle.role === "bound");
  }
  function startCrumble(nowMs) {
    structureState.nextTemplateId = nextTemplateId(structureState.activeTemplateId);
    structureState.nextTemplate = sampleTemplate(structureState.nextTemplateId, densityState.stage);
    structureState.nextAnchors = buildAnchorsForViewport(structureState.nextTemplate, densityState.stage);
    structureState.nextAnchorById = createAnchorIndex(structureState.nextAnchors);
    structureState.nextTopologyEdges = buildTopologyEdges(
      structureState.nextTemplate,
      structureState.nextAnchorById,
      densityState.stage
    );

    const bound = getBoundParticles();
    if (bound.length) {
      const centroid = bound.reduce(
        (acc, particle) => {
          acc.x += particle.x;
          acc.y += particle.y;
          return acc;
        },
        { x: 0, y: 0 }
      );
      phaseState.crumbleOriginX = centroid.x / bound.length;
      phaseState.crumbleOriginY = centroid.y / bound.length;
    } else {
      phaseState.crumbleOriginX = window.innerWidth * 0.5;
      phaseState.crumbleOriginY = window.innerHeight * 0.5;
    }

    particles.forEach((particle) => {
      if (particle.role !== "bound") return;
      const dx = particle.x - phaseState.crumbleOriginX;
      const dy = particle.y - phaseState.crumbleOriginY;
      const len = Math.hypot(dx, dy) || 1;
      const impulse = 0.75 + Math.random() * 0.95;
      particle.vx += (dx / len) * impulse + (Math.random() - 0.5) * 0.24;
      particle.vy += (dy / len) * impulse + (Math.random() - 0.5) * 0.24;
    });

    setPhase("crumble", nowMs);
  }

  function prepareRebuildTargets() {
    const boundParticles = getBoundParticles();
    if (!boundParticles.length || !structureState.nextAnchors.length) return;

    const shuffledTargets = shuffle(structureState.nextAnchors);
    while (shuffledTargets.length < boundParticles.length) {
      shuffledTargets.push(...shuffle(structureState.nextAnchors));
    }

    boundParticles.forEach((particle, index) => {
      const target = shuffledTargets[index];
      particle.rebuildTargetId = target.id;
      particle.rebuildStage = buildStageForLayer(target.layer);
      particle.assembleDelayJitter = (Math.random() - 0.5) * 0.08;
    });
  }

  function startRebuild(nowMs) {
    prepareRebuildTargets();
    setPhase("rebuild", nowMs);
  }

  function finishRebuild(nowMs) {
    structureState.activeTemplateId = structureState.nextTemplateId;
    structureState.nextTemplateId = nextTemplateId(structureState.activeTemplateId);
    rebuildAnchors();

    particles.forEach((particle) => {
      if (particle.role !== "bound") return;
      const anchor =
        structureState.anchorById.get(particle.rebuildTargetId) || structureState.anchors[0] || null;
      if (!anchor) return;
      particle.anchorId = anchor.id;
      particle.rebuildTargetId = anchor.id;
      particle.rebuildStage = buildStageForLayer(anchor.layer);
      particle.cluster = anchor.cluster;
      particle.layer = anchor.layer;
      particle.assembleDelayJitter = (Math.random() - 0.5) * 0.08;
    });

    setPhase("hold", nowMs);
  }

  function updatePhase(nowMs) {
    if (profile === "reduced") {
      phaseState.phase = "hold";
      phaseState.phaseProgress = 1;
      phaseState.phaseStartedMs = nowMs;
      return;
    }

    const elapsed = nowMs - phaseState.phaseStartedMs;
    if (phaseState.phase === "hold") {
      phaseState.phaseProgress = clamp(elapsed / config.phase.holdMs, 0, 1);
      if (elapsed >= config.phase.holdMs) startCrumble(nowMs);
      return;
    }
    if (phaseState.phase === "crumble") {
      phaseState.phaseProgress = clamp(elapsed / config.phase.crumbleMs, 0, 1);
      if (elapsed >= config.phase.crumbleMs) startRebuild(nowMs);
      return;
    }
    if (phaseState.phase === "rebuild") {
      phaseState.phaseProgress = clamp(elapsed / config.phase.rebuildMs, 0, 1);
      if (elapsed >= config.phase.rebuildMs) finishRebuild(nowMs);
    }
  }

  function resolveFocusTarget() {
    const focus = focusState.projectId ? projectFocusMap[focusState.projectId] : null;
    if (!focus) {
      focusState.targetStrength = 0;
      focusState.targetX = window.innerWidth * 0.5;
      focusState.targetY = window.innerHeight * 0.5;
      return;
    }
    focusState.targetStrength = 1;
    focusState.targetX = focus.nx * window.innerWidth;
    focusState.targetY = focus.ny * window.innerHeight;
  }

  function getFocusInfluence(x, y) {
    if (focusState.strength <= 0.001) return 0;
    const dx = x - focusState.x;
    const dy = y - focusState.y;
    const dist = Math.hypot(dx, dy);
    const radius = config.structureMode.reactionRadiusPx;
    if (dist >= radius) return 0;
    return (1 - dist / radius) * focusState.strength;
  }

  function updateFreeParticle(particle, dtScale, cfg) {
    const noiseFactor = profile === "reduced" ? 0.45 : 1;
    const phaseScale = phaseState.phase === "hold" ? 1 : 0.84;
    const noise = cfg.noise * 0.78 * noiseFactor * phaseScale;
    particle.vx = particle.vx * 0.985 + (Math.random() - 0.5) * noise;
    particle.vy = particle.vy * 0.985 + (Math.random() - 0.5) * noise;
    particle.x += particle.vx * dtScale + (Math.random() - 0.5) * cfg.driftSpeed * 1.1 * phaseScale;
    particle.y += particle.vy * dtScale + (Math.random() - 0.5) * cfg.driftSpeed * 1.1 * phaseScale;

    if (particle.x < 0 || particle.x > window.innerWidth) particle.vx *= -1;
    if (particle.y < 0 || particle.y > window.innerHeight) particle.vy *= -1;
    particle.cluster = clusterFromX(particle.x);
  }

  function updateBoundParticle(particle, dtScale, cfg) {
    const noiseFactor = profile === "reduced" ? 0.45 : 1;
    const noise = cfg.noise * noiseFactor;
    const focusInfluence = getFocusInfluence(particle.x, particle.y);

    if (profile === "reduced" || phaseState.phase === "hold") {
      const target = structureState.anchorById.get(particle.anchorId);
      if (!target) return;
      const spring = cfg.spring * (1 + focusInfluence * 0.22);
      const ax = (target.x - particle.x) * spring + (Math.random() - 0.5) * noise;
      const ay = (target.y - particle.y) * spring + (Math.random() - 0.5) * noise;
      particle.vx = particle.vx * cfg.damping + ax;
      particle.vy = particle.vy * cfg.damping + ay;
      particle.x += particle.vx * dtScale + (Math.random() - 0.5) * cfg.driftSpeed;
      particle.y += particle.vy * dtScale + (Math.random() - 0.5) * cfg.driftSpeed;
      particle.cluster = target.cluster;
      particle.layer = target.layer;
      return;
    }

    if (phaseState.phase === "crumble") {
      const dx = particle.x - phaseState.crumbleOriginX;
      const dy = particle.y - phaseState.crumbleOriginY;
      const len = Math.hypot(dx, dy) || 1;
      const radialX = (dx / len) * 0.016;
      const radialY = (dy / len) * 0.016;
      const swirlX = (particle.y - phaseState.crumbleOriginY) * 0.00013;
      const swirlY = (phaseState.crumbleOriginX - particle.x) * 0.00013;
      const crumbleEnergy = 1 - phaseState.phaseProgress * 0.35;
      particle.vx =
        particle.vx * 0.986 + (radialX + swirlX) * crumbleEnergy + (Math.random() - 0.5) * noise * 0.65;
      particle.vy =
        particle.vy * 0.986 + (radialY + swirlY) * crumbleEnergy + (Math.random() - 0.5) * noise * 0.65;
      particle.x += particle.vx * dtScale + (Math.random() - 0.5) * cfg.driftSpeed * 1.36;
      particle.y += particle.vy * dtScale + (Math.random() - 0.5) * cfg.driftSpeed * 1.36;
      particle.cluster = clusterFromX(particle.x);
      return;
    }

    const target = structureState.nextAnchorById.get(particle.rebuildTargetId);
    if (!target) return;

    const [baseStart, baseEnd] = getWaveWindow(target.layer);
    const jitter = particle.assembleDelayJitter || 0;
    const stageStart = clamp(baseStart + jitter, 0, 0.96);
    const stageEnd = clamp(baseEnd + jitter, stageStart + 0.05, 1);
    const progress = phaseState.phaseProgress;

    if (progress < stageStart) {
      particle.vx = particle.vx * 0.987 + (Math.random() - 0.5) * noise * 0.58;
      particle.vy = particle.vy * 0.987 + (Math.random() - 0.5) * noise * 0.58;
      particle.x += particle.vx * dtScale;
      particle.y += particle.vy * dtScale;
      particle.cluster = clusterFromX(particle.x);
      return;
    }

    const waveProgress = easeInOutSine(
      clamp((progress - stageStart) / Math.max(0.001, stageEnd - stageStart), 0, 1)
    );
    const spring = cfg.spring * (0.78 + waveProgress * 1.55 + focusInfluence * 0.2);
    const ax = (target.x - particle.x) * spring + (Math.random() - 0.5) * noise * 0.42;
    const ay = (target.y - particle.y) * spring + (Math.random() - 0.5) * noise * 0.42;
    particle.vx = particle.vx * cfg.damping + ax;
    particle.vy = particle.vy * cfg.damping + ay;
    particle.x += particle.vx * dtScale;
    particle.y += particle.vy * dtScale;
    particle.cluster = target.cluster;
    particle.layer = target.layer;
  }

  function updateParticles(dt, nowMs) {
    const cfg = profileConfig[profile];
    const dtScale = Math.min(2, dt / 16.6);

    updatePhase(nowMs);
    resolveFocusTarget();
    focusState.x += (focusState.targetX - focusState.x) * 0.08;
    focusState.y += (focusState.targetY - focusState.y) * 0.08;
    focusState.strength += (focusState.targetStrength - focusState.strength) * 0.08;

    particles.forEach((particle) => {
      if (particle.role === "free") updateFreeParticle(particle, dtScale, cfg);
      else updateBoundParticle(particle, dtScale, cfg);
      if (particle.x < 0 || particle.x > window.innerWidth) particle.vx *= -1;
      if (particle.y < 0 || particle.y > window.innerHeight) particle.vy *= -1;
    });
  }
  function structureVisibility() {
    if (phaseState.phase === "hold") return 1;
    if (phaseState.phase === "crumble") return Math.max(0.08, 1 - phaseState.phaseProgress);
    return 0.12 + phaseState.phaseProgress * 0.88;
  }

  function phaseEdgeFactor() {
    if (phaseState.phase === "hold") return 1;
    if (phaseState.phase === "crumble") return Math.max(0.05, 1 - phaseState.phaseProgress * 0.92);
    return 0.14 + phaseState.phaseProgress * 0.96;
  }

  function buildBoundLookup(useTargetAnchors) {
    const lookup = new Map();
    for (let i = 0; i < particles.length; i += 1) {
      const particle = particles[i];
      if (particle.role !== "bound") continue;
      const key = useTargetAnchors ? particle.rebuildTargetId : particle.anchorId;
      if (!key || lookup.has(key)) continue;
      lookup.set(key, i);
    }
    return lookup;
  }

  function drawTopologyBoundLinks(cfg, mode) {
    const useTargetAnchors = phaseState.phase === "rebuild";
    const lookup = buildBoundLookup(useTargetAnchors);
    const edgeList = useTargetAnchors ? structureState.nextTopologyEdges : structureState.topologyEdges;
    if (!edgeList.length) return;
    const clusterSpan = debugInteractionState.clusterAdjacencySpan;
    const boundStrength = clamp(debugInteractionState.boundBoundStrength, 0, 2);
    const topologyRgb = hexToRgbComma(
      debugVisualState.topologyLinkColor,
      defaultVisualState.topologyLinkColor
    );
    const lineWidth = lineWidthWithScale();

    const capBase = mode.topologyEdgeCapByProfile[profile] || 120;
    const stageFactor = densityState.stage >= 3 ? 0.56 : densityState.stage === 2 ? 0.74 : 1;
    const edgeCap = Math.max(18, Math.floor(capBase * stageFactor));
    const visibility = structureVisibility();
    const phaseFactor = phaseEdgeFactor();
    const linkCounts = new Array(particles.length).fill(0);
    const perParticleCap = Math.min(mode.maxLinksPerParticle, cfg.maxLinksPerParticle);

    let drawn = 0;
    for (let i = 0; i < edgeList.length; i += 1) {
      if (drawn >= edgeCap) break;
      const edge = edgeList[i];
      if (densityState.stage >= 2 && !CORE_LAYERS.has(edge.layer)) continue;
      if (densityState.stage >= 3 && SECONDARY_LAYERS.has(edge.layer)) continue;
      if (phaseState.phase === "rebuild") {
        const [waveStart] = getWaveWindow(edge.layer);
        if (phaseState.phaseProgress < clamp(waveStart - 0.04, 0, 1)) continue;
      }

      const fromIndex = lookup.get(edge.from);
      const toIndex = lookup.get(edge.to);
      if (fromIndex == null || toIndex == null) continue;
      if (linkCounts[fromIndex] >= perParticleCap || linkCounts[toIndex] >= perParticleCap) continue;

      const a = particles[fromIndex];
      const b = particles[toIndex];
      if (!isClusterAdjacent(a.cluster, b.cluster, clusterSpan)) continue;

      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.hypot(dx, dy);
      if (dist >= cfg.linkDistance * 1.16) continue;

      const focusA = getFocusInfluence(a.x, a.y);
      const focusB = getFocusInfluence(b.x, b.y);
      let alpha = (0.058 + edge.strength * 0.084 + (focusA + focusB) * 0.08) * phaseFactor;
      alpha *= visibility;
      alpha *= boundStrength;
      if (SECONDARY_LAYERS.has(edge.layer)) alpha *= 0.72;
      alpha = Math.min(mode.alphaCap, alpha);

      context.beginPath();
      context.strokeStyle = `rgba(${topologyRgb}, ${alpha.toFixed(3)})`;
      context.lineWidth = lineWidth;
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.stroke();

      linkCounts[fromIndex] += 1;
      linkCounts[toIndex] += 1;
      drawn += 1;
    }
  }

  function drawSecondaryProximityBoundLinks(boundIndices, cfg, mode) {
    if (densityState.stage >= 1 || phaseState.phase !== "hold" || densityState.overBudgetFrames >= 4) {
      return;
    }

    const clusterSpan = debugInteractionState.clusterAdjacencySpan;
    const boundStrength = clamp(debugInteractionState.boundBoundStrength, 0, 2);
    const topologyRgb = hexToRgbComma(
      debugVisualState.topologyLinkColor,
      defaultVisualState.topologyLinkColor
    );
    const lineWidth = lineWidthWithScale();
    const linkCounts = new Array(particles.length).fill(0);
    const linkCap = Math.max(1, Math.min(2, mode.maxLinksPerParticle - 3));

    for (let ii = 0; ii < boundIndices.length; ii += 1) {
      const i = boundIndices[ii];
      if (linkCounts[i] >= linkCap) continue;
      const a = particles[i];
      for (let jj = ii + 1; jj < boundIndices.length; jj += 1) {
        const j = boundIndices[jj];
        if (linkCounts[i] >= linkCap) break;
        if (linkCounts[j] >= linkCap) continue;
        const b = particles[j];
        if (!isClusterAdjacent(a.cluster, b.cluster, clusterSpan)) continue;

        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.hypot(dx, dy);
        const maxDist = cfg.linkDistance * 0.74;
        if (dist >= maxDist) continue;

        const alpha = Math.min(0.09, (1 - dist / maxDist) * 0.06 * boundStrength);
        context.beginPath();
        context.strokeStyle = `rgba(${topologyRgb}, ${alpha.toFixed(3)})`;
        context.lineWidth = lineWidth;
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();

        linkCounts[i] += 1;
        linkCounts[j] += 1;
      }
    }
  }

  function freePhaseScale() {
    return phaseState.phase === "hold" ? 1 : 0.55;
  }

  function drawFreeLinks(freeIndices, mode) {
    const phaseScale = freePhaseScale();
    const freeStrength = clamp(debugInteractionState.freeFreeStrength, 0, 2);
    const weakDistance = mode.freeParticles.weakLinkDistance * (phaseState.phase === "hold" ? 1 : 0.86);
    const weakAlphaCap = Math.min(mode.alphaCap, mode.freeParticles.weakAlphaCap * phaseScale * freeStrength);
    const freeRgb = hexToRgbComma(debugVisualState.freeLinkColor, defaultVisualState.freeLinkColor);
    const lineWidth = lineWidthWithScale();

    for (let ii = 0; ii < freeIndices.length; ii += 1) {
      const i = freeIndices[ii];
      const a = particles[i];
      let links = 0;
      for (let jj = ii + 1; jj < freeIndices.length; jj += 1) {
        if (links >= 2) break;
        const b = particles[freeIndices[jj]];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.hypot(dx, dy);
        if (dist >= weakDistance) continue;
        const alpha = Math.min(weakAlphaCap, (1 - dist / weakDistance) * weakAlphaCap);
        context.beginPath();
        context.strokeStyle = `rgba(${freeRgb}, ${alpha.toFixed(3)})`;
        context.lineWidth = lineWidth;
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();
        links += 1;
      }
    }
  }

  function drawWeakFreeToBoundLinks(freeIndices, boundIndices, mode) {
    const phaseScale = freePhaseScale();
    const crossStrength = clamp(debugInteractionState.freeBoundStrength, 0, 2);
    const clusterSpan = debugInteractionState.clusterAdjacencySpan;
    const weakDistance = mode.freeParticles.weakLinkDistance * 0.9;
    const weakAlphaCap = Math.min(
      mode.alphaCap,
      mode.freeParticles.weakAlphaCap * 0.68 * phaseScale * crossStrength
    );
    const gate = clamp(0.22 * phaseScale * debugInteractionState.freeBoundGateScale, 0, 1);
    const crossRgb = hexToRgbComma(debugVisualState.crossLinkColor, defaultVisualState.crossLinkColor);
    const lineWidth = lineWidthWithScale();

    for (let ii = 0; ii < freeIndices.length; ii += 1) {
      if (ii % 3 !== 0) continue;
      const freeParticle = particles[freeIndices[ii]];
      if (Math.random() > gate) continue;

      let nearest = null;
      let nearestDist = Number.POSITIVE_INFINITY;
      for (let jj = 0; jj < boundIndices.length; jj += 1) {
        const boundParticle = particles[boundIndices[jj]];
        if (!isClusterAdjacent(freeParticle.cluster, boundParticle.cluster, clusterSpan)) continue;
        const dx = freeParticle.x - boundParticle.x;
        const dy = freeParticle.y - boundParticle.y;
        const dist = Math.hypot(dx, dy);
        if (dist < weakDistance && dist < nearestDist) {
          nearestDist = dist;
          nearest = boundParticle;
        }
      }
      if (!nearest) continue;

      const alpha = Math.min(weakAlphaCap, (1 - nearestDist / weakDistance) * weakAlphaCap);
      context.beginPath();
      context.strokeStyle = `rgba(${crossRgb}, ${alpha.toFixed(3)})`;
      context.lineWidth = lineWidth;
      context.moveTo(freeParticle.x, freeParticle.y);
      context.lineTo(nearest.x, nearest.y);
      context.stroke();
    }
  }

  function drawPoints(boundIndices, freeIndices) {
    const visibility = structureVisibility();
    const freePointScale = phaseState.phase === "hold" ? 1 : 0.86;
    const pointSizeScale = clamp(debugVisualState.pointSizeScale, 0.4, 2.8);
    const boundRgb = hexToRgbComma(debugVisualState.boundPointColor, defaultVisualState.boundPointColor);
    const freeRgb = hexToRgbComma(debugVisualState.freePointColor, defaultVisualState.freePointColor);

    boundIndices.forEach((index) => {
      const p = particles[index];
      const focus = getFocusInfluence(p.x, p.y);
      const alpha = (0.52 + focus * 0.36) * visibility;
      context.beginPath();
      context.fillStyle = `rgba(${boundRgb}, ${alpha.toFixed(3)})`;
      context.arc(
        p.x,
        p.y,
        (p.radius + focus * 0.85) * pointSizeScale,
        0,
        Math.PI * 2
      );
      context.fill();
    });

    freeIndices.forEach((index) => {
      const p = particles[index];
      const focus = getFocusInfluence(p.x, p.y);
      const alpha = (0.28 + focus * 0.08) * freePointScale;
      context.beginPath();
      context.fillStyle = `rgba(${freeRgb}, ${alpha.toFixed(3)})`;
      context.arc(p.x, p.y, p.radius * pointSizeScale, 0, Math.PI * 2);
      context.fill();
    });
  }

  function drawFrame() {
    const cfg = profileConfig[profile];
    const mode = config.structureMode;
    const gradientAlphaScale = clamp(debugVisualState.gradientAlphaScale, 0, 2);
    const gradientStartAlpha = (0.09 * gradientAlphaScale).toFixed(3);
    const gradientEndAlpha = (0.05 * gradientAlphaScale).toFixed(3);
    const gradientStartRgb = hexToRgbComma(
      debugVisualState.gradientStartColor,
      defaultVisualState.gradientStartColor
    );
    const gradientEndRgb = hexToRgbComma(
      debugVisualState.gradientEndColor,
      defaultVisualState.gradientEndColor
    );

    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    const gradient = context.createLinearGradient(0, 0, window.innerWidth, window.innerHeight);
    gradient.addColorStop(0, `rgba(${gradientStartRgb}, ${gradientStartAlpha})`);
    gradient.addColorStop(1, `rgba(${gradientEndRgb}, ${gradientEndAlpha})`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, window.innerWidth, window.innerHeight);

    const boundIndices = [];
    const freeIndices = [];
    for (let i = 0; i < particles.length; i += 1) {
      if (particles[i].role === "free") freeIndices.push(i);
      else boundIndices.push(i);
    }

    drawTopologyBoundLinks(cfg, mode);
    drawSecondaryProximityBoundLinks(boundIndices, cfg, mode);
    drawFreeLinks(freeIndices, mode);
    drawWeakFreeToBoundLinks(freeIndices, boundIndices, mode);
    drawPoints(boundIndices, freeIndices);
  }

  function handleFrameBudget(frameDelta) {
    if (profile === "reduced") return;
    const cfg = profileConfig[profile];
    const budget = 1000 / cfg.fps;

    if (frameDelta > budget * 1.35) {
      densityState.overBudgetFrames += 1;
      densityState.underBudgetFrames = 0;
    } else if (frameDelta < budget * 1.06) {
      densityState.underBudgetFrames += 1;
      if (densityState.overBudgetFrames > 0) densityState.overBudgetFrames -= 1;
    }

    if (densityState.overBudgetFrames >= 14 && densityState.stage < 3) {
      densityState.stage += 1;
      densityState.overBudgetFrames = 0;
      rebuildAnchors();
      createParticles();
    } else if (densityState.underBudgetFrames >= 180 && densityState.stage > 0) {
      densityState.stage -= 1;
      densityState.underBudgetFrames = 0;
      rebuildAnchors();
      createParticles();
    }
  }
  function tick(nowMs) {
    if (!running) return;
    const cfg = profileConfig[profile];
    const frameDelta = nowMs - lastFrameTime;
    const minFrameDelta = 1000 / cfg.fps;
    if (frameDelta >= minFrameDelta) {
      updateParticles(frameDelta, nowMs);
      drawFrame();
      lastFrameTime = nowMs;
      handleFrameBudget(frameDelta);
    }
    rafId = requestAnimationFrame(tick);
  }

  function setQuality(nextProfile) {
    profile = nextProfile;
    if (profile === "reduced") {
      densityState.stage = Math.max(densityState.stage, 2);
      phaseState.phase = "hold";
      phaseState.phaseProgress = 1;
      phaseState.phaseStartedMs = performance.now();
    } else if (profile === "low") {
      densityState.stage = Math.max(densityState.stage, 1);
    } else {
      densityState.stage = 0;
    }

    rebuildAnchors();
    createParticles();
  }

  function setFocus(projectId = null) {
    focusState.projectId = projectId;
  }

  function applyDebugOverrides(overrides = {}) {
    const cfg = profileConfig[profile];
    const mode = config.structureMode;
    const sampling = mode.sampling;
    let geometryDirty = false;
    let gridDirty = false;
    let timingDirty = false;

    const colorKeys = [
      "boundPointColor",
      "freePointColor",
      "topologyLinkColor",
      "freeLinkColor",
      "crossLinkColor",
      "gradientStartColor",
      "gradientEndColor",
      "gridColor",
    ];

    const numberKeys = [
      "particleCount",
      "freeRatio",
      "linkDistance",
      "driftSpeed",
      "spring",
      "damping",
      "noise",
      "fps",
      "reactionRadiusPx",
      "topologyEdgeCap",
      "maxLinksPerParticle",
      "alphaCap",
      "weakLinkDistance",
      "weakAlphaCap",
      "sampleStepPx",
      "stitchMaxEdges",
      "stitchMaxDistance",
      "pointSizeScale",
      "linkWidthPx",
      "gridOpacity",
      "gridSizePx",
      "gradientAlphaScale",
      "holdMs",
      "crumbleMs",
      "rebuildMs",
      "boundBoundStrength",
      "freeFreeStrength",
      "freeBoundStrength",
      "freeBoundGateScale",
      "clusterAdjacencySpan",
    ];

    for (const key of colorKeys) {
      if (!(key in overrides)) continue;
      const fallback = defaultVisualState[key] || "#ffffff";
      const normalized = normalizeHexColor(String(overrides[key] ?? ""), fallback);
      debugVisualState[key] = normalized;
      if (key === "gridColor") gridDirty = true;
    }

    for (const key of numberKeys) {
      if (!(key in overrides)) continue;
      const value = Number(overrides[key]);
      if (!Number.isFinite(value)) continue;

      if (key === "particleCount") {
        cfg.particleCount = Math.max(24, Math.floor(value));
        geometryDirty = true;
      } else if (key === "freeRatio") {
        mode.freeParticles.ratioByProfile[profile] = clamp(value, 0.05, 0.5);
        geometryDirty = true;
      } else if (key === "linkDistance") {
        cfg.linkDistance = Math.max(40, value);
      } else if (key === "driftSpeed") {
        cfg.driftSpeed = Math.max(0.005, value);
      } else if (key === "spring") {
        cfg.spring = Math.max(0.001, value);
      } else if (key === "damping") {
        cfg.damping = clamp(value, 0.75, 0.995);
      } else if (key === "noise") {
        cfg.noise = Math.max(0, value);
      } else if (key === "fps") {
        cfg.fps = Math.max(8, Math.floor(value));
      } else if (key === "reactionRadiusPx") {
        mode.reactionRadiusPx = Math.max(60, value);
      } else if (key === "topologyEdgeCap") {
        mode.topologyEdgeCapByProfile[profile] = Math.max(12, Math.floor(value));
      } else if (key === "maxLinksPerParticle") {
        const cap = Math.max(1, Math.floor(value));
        cfg.maxLinksPerParticle = cap;
        mode.maxLinksPerParticle = cap;
      } else if (key === "alphaCap") {
        mode.alphaCap = clamp(value, 0.01, 0.6);
      } else if (key === "weakLinkDistance") {
        mode.freeParticles.weakLinkDistance = Math.max(16, value);
      } else if (key === "weakAlphaCap") {
        mode.freeParticles.weakAlphaCap = clamp(value, 0.005, 0.35);
      } else if (key === "sampleStepPx") {
        sampling.sampleStepPxByProfile[profile] = Math.max(4, Math.floor(value));
        geometryDirty = true;
      } else if (key === "stitchMaxEdges") {
        sampling.stitchMaxEdgesByProfile[profile] = Math.max(0, Math.floor(value));
        geometryDirty = true;
      } else if (key === "stitchMaxDistance") {
        sampling.stitchMaxDistanceNxyByProfile[profile] = clamp(value, 0.01, 0.4);
        geometryDirty = true;
      } else if (key === "pointSizeScale") {
        debugVisualState.pointSizeScale = clamp(value, 0.4, 2.8);
      } else if (key === "linkWidthPx") {
        debugVisualState.linkWidthPx = clamp(value, 0.4, 3);
      } else if (key === "gridOpacity") {
        debugVisualState.gridOpacity = clamp(value, 0, 1);
        gridDirty = true;
      } else if (key === "gridSizePx") {
        debugVisualState.gridSizePx = clamp(value, 12, 96);
        gridDirty = true;
      } else if (key === "gradientAlphaScale") {
        debugVisualState.gradientAlphaScale = clamp(value, 0, 2);
      } else if (key === "holdMs") {
        config.phase.holdMs = Math.max(2000, Math.floor(value));
        timingDirty = true;
      } else if (key === "crumbleMs") {
        config.phase.crumbleMs = Math.max(800, Math.floor(value));
        timingDirty = true;
      } else if (key === "rebuildMs") {
        config.phase.rebuildMs = Math.max(1200, Math.floor(value));
        timingDirty = true;
      } else if (key === "boundBoundStrength") {
        debugInteractionState.boundBoundStrength = clamp(value, 0, 2);
      } else if (key === "freeFreeStrength") {
        debugInteractionState.freeFreeStrength = clamp(value, 0, 2);
      } else if (key === "freeBoundStrength") {
        debugInteractionState.freeBoundStrength = clamp(value, 0, 2);
      } else if (key === "freeBoundGateScale") {
        debugInteractionState.freeBoundGateScale = clamp(value, 0, 2);
      } else if (key === "clusterAdjacencySpan") {
        debugInteractionState.clusterAdjacencySpan = Math.floor(clamp(value, 0, 4));
      }
    }

    if (timingDirty) {
      config.phase.cycleMs = config.phase.holdMs + config.phase.crumbleMs + config.phase.rebuildMs;
    }

    if (gridDirty) applyGridDebugVars();

    if (geometryDirty) {
      rebuildAnchors();
      createParticles();
    }
  }

  function restoreProfileDefaults(targetProfile) {
    const profileDefaults = defaultProfileState[targetProfile];
    if (profileDefaults) {
      profileConfig[targetProfile] = { ...profileConfig[targetProfile], ...profileDefaults };
    }
    const modeDefaults = defaultStructureState;
    if (modeDefaults.freeParticles?.ratioByProfile?.[targetProfile] != null) {
      config.structureMode.freeParticles.ratioByProfile[targetProfile] =
        modeDefaults.freeParticles.ratioByProfile[targetProfile];
    }
    if (modeDefaults.topologyEdgeCapByProfile?.[targetProfile] != null) {
      config.structureMode.topologyEdgeCapByProfile[targetProfile] =
        modeDefaults.topologyEdgeCapByProfile[targetProfile];
    }
    if (modeDefaults.sampling?.sampleStepPxByProfile?.[targetProfile] != null) {
      config.structureMode.sampling.sampleStepPxByProfile[targetProfile] =
        modeDefaults.sampling.sampleStepPxByProfile[targetProfile];
    }
    if (modeDefaults.sampling?.stitchMaxEdgesByProfile?.[targetProfile] != null) {
      config.structureMode.sampling.stitchMaxEdgesByProfile[targetProfile] =
        modeDefaults.sampling.stitchMaxEdgesByProfile[targetProfile];
    }
    if (modeDefaults.sampling?.stitchMaxDistanceNxyByProfile?.[targetProfile] != null) {
      config.structureMode.sampling.stitchMaxDistanceNxyByProfile[targetProfile] =
        modeDefaults.sampling.stitchMaxDistanceNxyByProfile[targetProfile];
    }
  }

  function applyDebugPreset(nextProfile) {
    if (!profileConfig[nextProfile]) return;
    restoreProfileDefaults(nextProfile);
    setQuality(nextProfile);
  }

  function resetDebugOverrides() {
    Object.keys(defaultProfileState).forEach((preset) => restoreProfileDefaults(preset));
    config.phase.cycleMs = defaultPhaseState.cycleMs;
    config.phase.holdMs = defaultPhaseState.holdMs;
    config.phase.crumbleMs = defaultPhaseState.crumbleMs;
    config.phase.rebuildMs = defaultPhaseState.rebuildMs;
    config.structureMode.maxLinksPerParticle = defaultStructureState.maxLinksPerParticle;
    config.structureMode.alphaCap = defaultStructureState.alphaCap;
    config.structureMode.reactionRadiusPx = defaultStructureState.reactionRadiusPx;
    config.structureMode.freeParticles.weakLinkDistance =
      defaultStructureState.freeParticles.weakLinkDistance;
    config.structureMode.freeParticles.weakAlphaCap =
      defaultStructureState.freeParticles.weakAlphaCap;
    config.structureMode.sampling.stitchingEnabled =
      defaultStructureState.sampling.stitchingEnabled;
    Object.assign(debugVisualState, cloneDeep(defaultVisualState));
    Object.assign(debugInteractionState, cloneDeep(defaultInteractionState));
    applyGridDebugVars();
    setQuality(getMotionProfile());
  }

  function getDebugState() {
    const cfg = profileConfig[profile];
    const mode = config.structureMode;
    return {
      profile,
      running,
      particleCount: cfg.particleCount,
      freeRatio: mode.freeParticles.ratioByProfile[profile] ?? 0.2,
      linkDistance: cfg.linkDistance,
      driftSpeed: cfg.driftSpeed,
      spring: cfg.spring,
      damping: cfg.damping,
      noise: cfg.noise,
      fps: cfg.fps,
      reactionRadiusPx: mode.reactionRadiusPx,
      topologyEdgeCap: mode.topologyEdgeCapByProfile[profile] || 0,
      maxLinksPerParticle: mode.maxLinksPerParticle,
      alphaCap: mode.alphaCap,
      weakLinkDistance: mode.freeParticles.weakLinkDistance,
      weakAlphaCap: mode.freeParticles.weakAlphaCap,
      sampleStepPx: mode.sampling.sampleStepPxByProfile[profile] || 10,
      stitchMaxEdges: mode.sampling.stitchMaxEdgesByProfile[profile] || 0,
      stitchMaxDistance: mode.sampling.stitchMaxDistanceNxyByProfile[profile] || 0,
      boundPointColor: debugVisualState.boundPointColor,
      freePointColor: debugVisualState.freePointColor,
      topologyLinkColor: debugVisualState.topologyLinkColor,
      freeLinkColor: debugVisualState.freeLinkColor,
      crossLinkColor: debugVisualState.crossLinkColor,
      gradientStartColor: debugVisualState.gradientStartColor,
      gradientEndColor: debugVisualState.gradientEndColor,
      gridColor: debugVisualState.gridColor,
      pointSizeScale: debugVisualState.pointSizeScale,
      linkWidthPx: debugVisualState.linkWidthPx,
      gridOpacity: debugVisualState.gridOpacity,
      gridSizePx: debugVisualState.gridSizePx,
      gradientAlphaScale: debugVisualState.gradientAlphaScale,
      holdMs: config.phase.holdMs,
      crumbleMs: config.phase.crumbleMs,
      rebuildMs: config.phase.rebuildMs,
      boundBoundStrength: debugInteractionState.boundBoundStrength,
      freeFreeStrength: debugInteractionState.freeFreeStrength,
      freeBoundStrength: debugInteractionState.freeBoundStrength,
      freeBoundGateScale: debugInteractionState.freeBoundGateScale,
      clusterAdjacencySpan: debugInteractionState.clusterAdjacencySpan,
    };
  }

  function isPaused() {
    return !running;
  }

  function pause() {
    running = false;
    cancelAnimationFrame(rafId);
  }

  function resume() {
    if (running) return;
    running = true;
    lastFrameTime = performance.now();
    rafId = requestAnimationFrame(tick);
  }

  function handleResize() {
    resizeCanvas();
    rebuildAnchors();
    createParticles();
  }

  function handleMotionPreferenceChange() {
    setQuality(getMotionProfile());
  }

  function destroy() {
    pause();
    window.removeEventListener("resize", handleResize);
    prefersReduced.removeEventListener("change", handleMotionPreferenceChange);
    window.removeEventListener(THEME_TOKENS_APPLIED_EVENT, handleThemeTokensApplied);
  }

  handleThemeTokensApplied({ detail: { tokens: readThemeTokensFromRoot() } });
  resizeCanvas();
  rebuildAnchors();
  createParticles();
  window.addEventListener("resize", handleResize);
  prefersReduced.addEventListener("change", handleMotionPreferenceChange);
  window.addEventListener(THEME_TOKENS_APPLIED_EVENT, handleThemeTokensApplied);
  lastFrameTime = performance.now();
  rafId = requestAnimationFrame(tick);

  return {
    setQuality,
    setFocus,
    applyDebugOverrides,
    applyDebugPreset,
    resetDebugOverrides,
    getDebugState,
    isPaused,
    pause,
    resume,
    destroy,
  };
}

function setActiveProject(projectId) {
  const cards = document.querySelectorAll(".project-card[data-project]");
  const nodes = document.querySelectorAll("#story-map .node[data-project]");
  const routes = document.querySelectorAll("#story-map .route[data-route]");

  cards.forEach((card) => {
    card.classList.toggle("is-active", card.dataset.project === projectId);
  });
  nodes.forEach((node) => {
    node.classList.toggle("is-active", node.dataset.project === projectId);
  });
  routes.forEach((route) => {
    const pair = route.dataset.route || "";
    route.classList.toggle("is-active", pair.includes(projectId));
  });
}

function setupMapInteractions(backgroundEngine) {
  const cards = document.querySelectorAll(".project-card[data-project]");
  const projectGrid = document.querySelector(".project-grid");

  cards.forEach((card) => {
    const activate = () => {
      const projectId = card.dataset.project || "";
      setActiveProject(projectId);
      backgroundEngine.setFocus(projectId);
    };

    card.addEventListener("mouseenter", activate);
    card.addEventListener("focus", activate);
    card.addEventListener("click", activate);
    card.addEventListener("mouseleave", () => backgroundEngine.setFocus(null));
    card.addEventListener("blur", () => backgroundEngine.setFocus(null));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      }
    });
  });

  if (projectGrid) {
    projectGrid.addEventListener("mouseleave", () => backgroundEngine.setFocus(null));
  }
}

function setupBackgroundTestControls(backgroundEngine) {
  if (!backgroundTestMode) return;
  if (!backgroundEngine || typeof backgroundEngine.getDebugState !== "function") return;

  const persistedState = readBackgroundTestState();
  if (persistedState && typeof persistedState === "object") {
    backgroundEngine.applyDebugOverrides(persistedState);
  }

  const state = backgroundEngine.getDebugState();
  if (!state) return;

  const tabs = [
    { id: "appearance", label: "Appearance" },
    { id: "animation", label: "Animation" },
    { id: "interaction", label: "Group Interaction" },
  ];

  const controls = [
    { tab: "appearance", key: "boundPointColor", label: "Bound Color", type: "color" },
    { tab: "appearance", key: "freePointColor", label: "Free Color", type: "color" },
    { tab: "appearance", key: "topologyLinkColor", label: "Topology Color", type: "color" },
    { tab: "appearance", key: "freeLinkColor", label: "Free Link Color", type: "color" },
    { tab: "appearance", key: "crossLinkColor", label: "Cross Link Color", type: "color" },
    { tab: "appearance", key: "gridColor", label: "Grid Color", type: "color" },
    {
      tab: "appearance",
      key: "pointSizeScale",
      label: "Point Scale",
      type: "range",
      min: 0.4,
      max: 2.8,
      step: 0.01,
    },
    {
      tab: "appearance",
      key: "linkWidthPx",
      label: "Link Width",
      type: "range",
      min: 0.4,
      max: 3,
      step: 0.05,
    },
    {
      tab: "appearance",
      key: "gridOpacity",
      label: "Grid Opacity",
      type: "range",
      min: 0,
      max: 1,
      step: 0.01,
    },
    {
      tab: "appearance",
      key: "gridSizePx",
      label: "Grid Size",
      type: "range",
      min: 12,
      max: 96,
      step: 1,
    },
    {
      tab: "appearance",
      key: "gradientAlphaScale",
      label: "Gradient Alpha",
      type: "range",
      min: 0,
      max: 2,
      step: 0.01,
    },
    {
      tab: "animation",
      key: "particleCount",
      label: "Particles",
      type: "range",
      min: 24,
      max: 220,
      step: 1,
    },
    {
      tab: "animation",
      key: "freeRatio",
      label: "Free Ratio",
      type: "range",
      min: 0.05,
      max: 0.5,
      step: 0.01,
    },
    {
      tab: "animation",
      key: "driftSpeed",
      label: "Drift Speed",
      type: "range",
      min: 0.01,
      max: 0.5,
      step: 0.005,
    },
    {
      tab: "animation",
      key: "spring",
      label: "Spring",
      type: "range",
      min: 0.001,
      max: 0.06,
      step: 0.001,
    },
    {
      tab: "animation",
      key: "damping",
      label: "Damping",
      type: "range",
      min: 0.8,
      max: 0.995,
      step: 0.001,
    },
    { tab: "animation", key: "noise", label: "Noise", type: "range", min: 0, max: 0.3, step: 0.005 },
    { tab: "animation", key: "fps", label: "FPS Target", type: "range", min: 8, max: 60, step: 1 },
    {
      tab: "animation",
      key: "holdMs",
      label: "Hold Ms",
      type: "range",
      min: 4000,
      max: 30000,
      step: 100,
    },
    {
      tab: "animation",
      key: "crumbleMs",
      label: "Crumble Ms",
      type: "range",
      min: 1000,
      max: 12000,
      step: 100,
    },
    {
      tab: "animation",
      key: "rebuildMs",
      label: "Rebuild Ms",
      type: "range",
      min: 2000,
      max: 16000,
      step: 100,
    },
    {
      tab: "animation",
      key: "sampleStepPx",
      label: "Sample Step",
      type: "range",
      min: 4,
      max: 20,
      step: 1,
    },
    {
      tab: "animation",
      key: "stitchMaxEdges",
      label: "Stitch Max Edges",
      type: "range",
      min: 0,
      max: 10,
      step: 1,
    },
    {
      tab: "animation",
      key: "stitchMaxDistance",
      label: "Stitch Max Dist",
      type: "range",
      min: 0.01,
      max: 0.25,
      step: 0.005,
    },
    {
      tab: "interaction",
      key: "linkDistance",
      label: "Link Distance",
      type: "range",
      min: 50,
      max: 220,
      step: 1,
    },
    {
      tab: "interaction",
      key: "reactionRadiusPx",
      label: "Reaction Radius",
      type: "range",
      min: 60,
      max: 360,
      step: 1,
    },
    {
      tab: "interaction",
      key: "topologyEdgeCap",
      label: "Topology Edge Cap",
      type: "range",
      min: 16,
      max: 260,
      step: 1,
    },
    {
      tab: "interaction",
      key: "maxLinksPerParticle",
      label: "Max Links/Point",
      type: "range",
      min: 1,
      max: 10,
      step: 1,
    },
    {
      tab: "interaction",
      key: "alphaCap",
      label: "Alpha Cap",
      type: "range",
      min: 0.01,
      max: 0.6,
      step: 0.005,
    },
    {
      tab: "interaction",
      key: "weakLinkDistance",
      label: "Weak Link Distance",
      type: "range",
      min: 20,
      max: 220,
      step: 1,
    },
    {
      tab: "interaction",
      key: "weakAlphaCap",
      label: "Weak Alpha Cap",
      type: "range",
      min: 0.005,
      max: 0.3,
      step: 0.005,
    },
    {
      tab: "interaction",
      key: "boundBoundStrength",
      label: "Bound-Bound Strength",
      type: "range",
      min: 0,
      max: 2,
      step: 0.01,
    },
    {
      tab: "interaction",
      key: "freeFreeStrength",
      label: "Free-Free Strength",
      type: "range",
      min: 0,
      max: 2,
      step: 0.01,
    },
    {
      tab: "interaction",
      key: "freeBoundStrength",
      label: "Free-Bound Strength",
      type: "range",
      min: 0,
      max: 2,
      step: 0.01,
    },
    {
      tab: "interaction",
      key: "freeBoundGateScale",
      label: "Free-Bound Gate",
      type: "range",
      min: 0,
      max: 2,
      step: 0.01,
    },
    {
      tab: "interaction",
      key: "clusterAdjacencySpan",
      label: "Cluster Span",
      type: "range",
      min: 0,
      max: 4,
      step: 1,
    },
  ];

  const panel = document.createElement("aside");
  panel.id = "bg-test-controls";
  panel.setAttribute("aria-label", "Background test controls");
  const tabButtonsHtml = tabs
    .map(
      (tab, index) => `
      <button
        type="button"
        class="bg-test-tab"
        role="tab"
        id="bg-tab-${tab.id}"
        data-tab="${tab.id}"
        aria-controls="bg-panel-${tab.id}"
        aria-selected="${index === 0 ? "true" : "false"}"
        tabindex="${index === 0 ? "0" : "-1"}"
      >${tab.label}</button>
    `
    )
    .join("");
  const tabPanelsHtml = tabs
    .map(
      (tab, index) => `
      <section
        class="bg-test-panel"
        role="tabpanel"
        id="bg-panel-${tab.id}"
        aria-labelledby="bg-tab-${tab.id}"
        ${index === 0 ? "" : "hidden"}
      ></section>
    `
    )
    .join("");

  panel.innerHTML = `
    <h2>bgTest Controls</h2>
    <p class="bg-test-subtitle">Live tuning for appearance, animation and interaction</p>
    <div class="bg-test-presets" role="group" aria-label="Quality presets">
      <button type="button" data-preset="high">High</button>
      <button type="button" data-preset="medium">Medium</button>
      <button type="button" data-preset="low">Low</button>
      <button type="button" data-action="reset">Reset</button>
      <button type="button" data-action="pause">Pause</button>
    </div>
    <div class="bg-test-tabs" role="tablist" aria-label="Control tabs">
      ${tabButtonsHtml}
    </div>
    ${tabPanelsHtml}
  `;
  document.body.appendChild(panel);

  const tabButtons = Array.from(panel.querySelectorAll(".bg-test-tab"));
  const tabPanels = Array.from(panel.querySelectorAll(".bg-test-panel"));
  const panelByTab = new Map();
  tabPanels.forEach((node) => {
    const id = node.id.replace("bg-panel-", "");
    panelByTab.set(id, node);
  });
  const controlMap = new Map();
  let activeTab = tabs[0].id;

  function decimalPlaces(step) {
    const text = String(step);
    const dot = text.indexOf(".");
    return dot < 0 ? 0 : text.length - dot - 1;
  }

  function setTab(nextTab, focus = false) {
    activeTab = tabs.some((tab) => tab.id === nextTab) ? nextTab : tabs[0].id;
    tabButtons.forEach((button) => {
      const selected = button.dataset.tab === activeTab;
      button.setAttribute("aria-selected", selected ? "true" : "false");
      button.tabIndex = selected ? 0 : -1;
      if (selected && focus) button.focus();
    });
    tabPanels.forEach((tabPanel) => {
      tabPanel.hidden = tabPanel.id !== `bg-panel-${activeTab}`;
    });
  }

  function updateOutput(entry, value) {
    if (entry.control.type === "color") {
      entry.output.textContent = normalizeHexColor(String(value || "#ffffff")).toUpperCase();
      return;
    }
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    entry.output.textContent = number.toFixed(decimalPlaces(entry.control.step || 1));
  }

  function pickPersistedValues(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return {};
    const payload = {};
    controls.forEach((control) => {
      if (!(control.key in snapshot)) return;
      payload[control.key] = snapshot[control.key];
    });
    return payload;
  }

  function persistFromSnapshot(snapshot) {
    writeBackgroundTestState(pickPersistedValues(snapshot));
  }

  controls.forEach((control) => {
    const row = document.createElement("label");
    row.className = "bg-test-control-row";
    if (control.type === "color") {
      row.innerHTML = `
        <span class="bg-test-control-name">${control.label}</span>
        <input type="color" />
        <output></output>
      `;
    } else {
      row.innerHTML = `
        <span class="bg-test-control-name">${control.label}</span>
        <input type="range" min="${control.min}" max="${control.max}" step="${control.step}" />
        <output></output>
      `;
    }
    const input = row.querySelector("input");
    const output = row.querySelector("output");
    if (!input || !output) return;
    input.addEventListener("input", () => {
      const value =
        control.type === "color"
          ? normalizeHexColor(input.value)
          : Number(input.value);
      backgroundEngine.applyDebugOverrides({ [control.key]: value });
      const snapshot = backgroundEngine.getDebugState();
      const display = snapshot ? snapshot[control.key] : value;
      if (control.type === "color") {
        input.value = normalizeHexColor(String(display), "#ffffff");
      }
      updateOutput({ control, output }, display);
      if (snapshot) persistFromSnapshot(snapshot);
    });
    controlMap.set(control.key, { input, output, control });
    panelByTab.get(control.tab)?.appendChild(row);
  });

  tabButtons.forEach((button, index) => {
    button.addEventListener("click", () => setTab(button.dataset.tab || tabs[0].id));
    button.addEventListener("keydown", (event) => {
      let nextIndex = null;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % tabButtons.length;
      if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabButtons.length) % tabButtons.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = tabButtons.length - 1;
      if (nextIndex != null) {
        event.preventDefault();
        const nextButton = tabButtons[nextIndex];
        if (nextButton) setTab(nextButton.dataset.tab || tabs[0].id, true);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setTab(button.dataset.tab || tabs[0].id, true);
      }
    });
  });

  const pauseButton = panel.querySelector('button[data-action="pause"]');

  function syncPauseLabel() {
    if (!pauseButton) return;
    pauseButton.textContent = backgroundEngine.isPaused() ? "Resume" : "Pause";
  }

  function syncFromState() {
    const snapshot = backgroundEngine.getDebugState();
    if (!snapshot) return;
    controlMap.forEach((entry, key) => {
      if (entry.control.type === "color") {
        const color = normalizeHexColor(String(snapshot[key] || "#ffffff"), "#ffffff");
        entry.input.value = color;
        updateOutput(entry, color);
        return;
      }
      const value = Number(snapshot[key]);
      if (!Number.isFinite(value)) return;
      entry.input.value = String(value);
      updateOutput(entry, value);
    });
    syncPauseLabel();
  }

  panel.querySelectorAll("button[data-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      const preset = button.getAttribute("data-preset");
      if (!preset) return;
      backgroundEngine.applyDebugPreset(preset);
      syncFromState();
      const snapshot = backgroundEngine.getDebugState();
      if (snapshot) persistFromSnapshot(snapshot);
    });
  });

  panel.querySelector('button[data-action="reset"]')?.addEventListener("click", () => {
    backgroundEngine.resetDebugOverrides();
    syncFromState();
    const snapshot = backgroundEngine.getDebugState();
    if (snapshot) persistFromSnapshot(snapshot);
  });

  pauseButton?.addEventListener("click", () => {
    if (backgroundEngine.isPaused()) backgroundEngine.resume();
    else backgroundEngine.pause();
    syncPauseLabel();
  });

  setTab(activeTab);
  syncFromState();
}

function setupThemeEditorControls(initialThemeName = "custom") {
  if (!themeEditorMode) return;

  const tabs = [
    { id: "palette", label: "Palette" },
    { id: "surface-grid", label: "Surface/Grid" },
    { id: "components", label: "Components" },
    { id: "canvas", label: "Canvas" },
  ];
  const controls = [
    { tab: "palette", key: "--bg", label: "Background", type: "color" },
    { tab: "palette", key: "--bg-soft", label: "Background Soft", type: "color" },
    { tab: "palette", key: "--bg-radial-start", label: "Radial Start", type: "color" },
    { tab: "palette", key: "--bg-radial-end", label: "Radial End", type: "color" },
    { tab: "palette", key: "--text", label: "Text", type: "color" },
    { tab: "palette", key: "--text-dim", label: "Text Dim", type: "color" },
    { tab: "palette", key: "--accent", label: "Accent", type: "color" },
    { tab: "palette", key: "--accent-warm", label: "Accent Warm", type: "color" },
    { tab: "palette", key: "--danger", label: "Danger", type: "color" },
    {
      tab: "surface-grid",
      key: "--surface",
      label: "Surface",
      type: "rgba",
      placeholder: "rgba(15, 34, 48, 0.72)",
    },
    {
      tab: "surface-grid",
      key: "--surface-strong",
      label: "Surface Strong",
      type: "rgba",
      placeholder: "rgba(12, 28, 39, 0.9)",
    },
    {
      tab: "surface-grid",
      key: "--line",
      label: "Line",
      type: "rgba",
      placeholder: "rgba(125, 176, 198, 0.24)",
    },
    {
      tab: "surface-grid",
      key: "--bg-grid-rgb",
      label: "Grid Color",
      type: "grid-rgb",
      placeholder: "255 255 255",
    },
    {
      tab: "surface-grid",
      key: "--bg-grid-opacity",
      label: "Grid Opacity",
      type: "range",
      min: 0,
      max: 1,
      step: 0.01,
    },
    {
      tab: "surface-grid",
      key: "--bg-grid-size",
      label: "Grid Size",
      type: "range",
      min: 12,
      max: 120,
      step: 1,
      unit: "px",
    },
    {
      tab: "surface-grid",
      key: "--shadow",
      label: "Section Shadow",
      type: "text",
      placeholder: "0 16px 40px rgba(0, 0, 0, 0.34)",
    },
    {
      tab: "surface-grid",
      key: "--header-bg",
      label: "Header Background",
      type: "rgba",
      placeholder: "rgba(7, 19, 29, 0.68)",
    },
    {
      tab: "surface-grid",
      key: "--nav-hover-bg",
      label: "Nav Hover",
      type: "rgba",
      placeholder: "rgba(43, 210, 187, 0.14)",
    },
    {
      tab: "components",
      key: "--control-panel-border",
      label: "Panel Border",
      type: "rgba",
      placeholder: "rgba(125, 176, 198, 0.35)",
    },
    {
      tab: "components",
      key: "--control-panel-bg",
      label: "Panel Background",
      type: "rgba",
      placeholder: "rgba(5, 15, 24, 0.82)",
    },
    {
      tab: "components",
      key: "--control-panel-shadow",
      label: "Panel Shadow",
      type: "text",
      placeholder: "0 10px 26px rgba(0, 0, 0, 0.4)",
    },
    {
      tab: "components",
      key: "--control-btn-border",
      label: "Control Button Border",
      type: "rgba",
      placeholder: "rgba(125, 176, 198, 0.45)",
    },
    {
      tab: "components",
      key: "--control-btn-bg",
      label: "Control Button Bg",
      type: "rgba",
      placeholder: "rgba(14, 35, 47, 0.85)",
    },
    {
      tab: "components",
      key: "--control-tab-border",
      label: "Control Tab Border",
      type: "rgba",
      placeholder: "rgba(125, 176, 198, 0.4)",
    },
    {
      tab: "components",
      key: "--control-tab-bg",
      label: "Control Tab Bg",
      type: "rgba",
      placeholder: "rgba(11, 28, 40, 0.9)",
    },
    {
      tab: "components",
      key: "--theme-tab-active-bg",
      label: "Theme Tab Active Bg",
      type: "rgba",
      placeholder: "rgba(255, 207, 102, 0.16)",
    },
    {
      tab: "components",
      key: "--theme-tab-active-border",
      label: "Theme Tab Active Border",
      type: "rgba",
      placeholder: "rgba(255, 207, 102, 0.44)",
    },
    {
      tab: "components",
      key: "--bg-test-tab-active-bg",
      label: "BgTest Tab Active Bg",
      type: "rgba",
      placeholder: "rgba(43, 210, 187, 0.18)",
    },
    {
      tab: "components",
      key: "--bg-test-tab-active-border",
      label: "BgTest Tab Active Border",
      type: "rgba",
      placeholder: "rgba(43, 210, 187, 0.5)",
    },
    {
      tab: "components",
      key: "--control-input-border",
      label: "Control Input Border",
      type: "rgba",
      placeholder: "rgba(125, 176, 198, 0.45)",
    },
    {
      tab: "components",
      key: "--control-input-bg",
      label: "Control Input Bg",
      type: "rgba",
      placeholder: "rgba(16, 37, 49, 0.7)",
    },
    {
      tab: "components",
      key: "--section-gradient-start",
      label: "Section Gradient Start",
      type: "rgba",
      placeholder: "rgba(15, 30, 43, 0.9)",
    },
    {
      tab: "components",
      key: "--section-gradient-mid",
      label: "Section Gradient Mid",
      type: "rgba",
      placeholder: "rgba(9, 22, 33, 0.84)",
    },
    {
      tab: "components",
      key: "--section-gradient-end",
      label: "Section Gradient End",
      type: "rgba",
      placeholder: "rgba(7, 17, 25, 0.89)",
    },
    { tab: "components", key: "--btn-primary-mid", label: "Primary Mid", type: "color" },
    { tab: "components", key: "--btn-primary-end", label: "Primary End", type: "color" },
    { tab: "components", key: "--btn-primary-text", label: "Primary Text", type: "color" },
    {
      tab: "components",
      key: "--btn-primary-shadow",
      label: "Primary Shadow",
      type: "text",
      placeholder: "0 8px 30px rgba(43, 210, 187, 0.35)",
    },
    {
      tab: "components",
      key: "--btn-ghost-border",
      label: "Ghost Border",
      type: "rgba",
      placeholder: "rgba(255, 255, 255, 0.22)",
    },
    {
      tab: "components",
      key: "--btn-ghost-bg",
      label: "Ghost Background",
      type: "rgba",
      placeholder: "rgba(255, 255, 255, 0.03)",
    },
    {
      tab: "components",
      key: "--card-active-border",
      label: "Card Active Border",
      type: "rgba",
      placeholder: "rgba(255, 207, 102, 0.72)",
    },
    {
      tab: "components",
      key: "--map-shell-bg",
      label: "Map Shell Bg",
      type: "rgba",
      placeholder: "rgba(4, 13, 20, 0.5)",
    },
    {
      tab: "components",
      key: "--map-bg-fill",
      label: "Map Background Fill",
      type: "rgba",
      placeholder: "rgba(8, 20, 30, 0.88)",
    },
    {
      tab: "components",
      key: "--map-region-fill",
      label: "Map Region Fill",
      type: "rgba",
      placeholder: "rgba(13, 41, 56, 0.6)",
    },
    {
      tab: "components",
      key: "--map-region-stroke",
      label: "Map Region Stroke",
      type: "rgba",
      placeholder: "rgba(95, 157, 187, 0.35)",
    },
    {
      tab: "components",
      key: "--map-node-pulse-fill",
      label: "Map Node Pulse Fill",
      type: "rgba",
      placeholder: "rgba(43, 210, 187, 0.12)",
    },
    {
      tab: "components",
      key: "--map-node-pulse-stroke",
      label: "Map Node Pulse Stroke",
      type: "rgba",
      placeholder: "rgba(43, 210, 187, 0.35)",
    },
    {
      tab: "components",
      key: "--route-gradient-start",
      label: "Route Gradient Start",
      type: "color",
    },
    {
      tab: "components",
      key: "--route-gradient-end",
      label: "Route Gradient End",
      type: "color",
    },
    {
      tab: "canvas",
      key: "--canvas-bound-point",
      label: "Bound Point",
      type: "color",
    },
    {
      tab: "canvas",
      key: "--canvas-free-point",
      label: "Free Point",
      type: "color",
    },
    {
      tab: "canvas",
      key: "--canvas-topology-link",
      label: "Topology Link",
      type: "color",
    },
    {
      tab: "canvas",
      key: "--canvas-free-link",
      label: "Free Link",
      type: "color",
    },
    {
      tab: "canvas",
      key: "--canvas-cross-link",
      label: "Cross Link",
      type: "color",
    },
    {
      tab: "canvas",
      key: "--canvas-gradient-start",
      label: "Gradient Start",
      type: "color",
    },
    {
      tab: "canvas",
      key: "--canvas-gradient-end",
      label: "Gradient End",
      type: "color",
    },
  ];

  const initialTokens = sanitizeThemeTokens(readThemeTokensFromRoot(), readThemeTokensFromRoot());
  let activeThemeName = initialThemeName || "custom";

  const panel = document.createElement("aside");
  panel.id = "theme-editor-controls";
  panel.setAttribute("aria-label", "Theme editor controls");

  const tabButtonsHtml = tabs
    .map(
      (tab, index) => `
      <button
        type="button"
        class="theme-editor-tab"
        role="tab"
        id="theme-tab-${tab.id}"
        data-tab="${tab.id}"
        aria-controls="theme-panel-${tab.id}"
        aria-selected="${index === 0 ? "true" : "false"}"
        tabindex="${index === 0 ? "0" : "-1"}"
      >${tab.label}</button>
    `
    )
    .join("");

  const tabPanelsHtml = tabs
    .map(
      (tab, index) => `
      <section
        class="theme-editor-panel"
        role="tabpanel"
        id="theme-panel-${tab.id}"
        aria-labelledby="theme-tab-${tab.id}"
        ${index === 0 ? "" : "hidden"}
      ></section>
    `
    )
    .join("");

  panel.innerHTML = `
    <h2>Theme Editor</h2>
    <p class="theme-editor-subtitle">Tune tokens while previewing full page layout</p>
    <div class="theme-editor-actions" role="group" aria-label="Theme actions">
      <button type="button" data-action="theme-dark">Dark</button>
      <button type="button" data-action="theme-light">Light</button>
      <button type="button" data-action="save">Save Theme File</button>
      <button type="button" data-action="reset">Reset Theme</button>
    </div>
    <div class="theme-editor-tabs" role="tablist" aria-label="Theme editor tabs">
      ${tabButtonsHtml}
    </div>
    ${tabPanelsHtml}
  `;
  document.body.appendChild(panel);

  const panelByTab = new Map();
  Array.from(panel.querySelectorAll(".theme-editor-panel")).forEach((node) => {
    const id = node.id.replace("theme-panel-", "");
    panelByTab.set(id, node);
  });
  const tabButtons = Array.from(panel.querySelectorAll(".theme-editor-tab"));
  const tabPanels = Array.from(panel.querySelectorAll(".theme-editor-panel"));
  const controlMap = new Map();
  let activeTab = tabs[0].id;

  function decimalPlaces(step) {
    const text = String(step || 1);
    const dot = text.indexOf(".");
    return dot < 0 ? 0 : text.length - dot - 1;
  }

  function getCurrentTokens() {
    return sanitizeThemeTokens(readThemeTokensFromRoot(), initialTokens);
  }

  function setTab(nextTab, focus = false) {
    activeTab = tabs.some((tab) => tab.id === nextTab) ? nextTab : tabs[0].id;
    tabButtons.forEach((button) => {
      const selected = button.dataset.tab === activeTab;
      button.setAttribute("aria-selected", selected ? "true" : "false");
      button.tabIndex = selected ? 0 : -1;
      if (selected && focus) button.focus();
    });
    tabPanels.forEach((tabPanel) => {
      tabPanel.hidden = tabPanel.id !== `theme-panel-${activeTab}`;
    });
  }

  async function applyNamedTheme(name) {
    const loaded = await loadThemeFromFile(name, getCurrentTokens());
    if (!loaded) return;
    activeThemeName = loaded.name || name;
    syncInputs();
  }

  function exportThemeToFile() {
    const payload = {
      version: THEME_FILE_VERSION,
      name: activeThemeName,
      tokens: getCurrentTokens(),
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `logistruct-theme-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
  }

  function applySingleToken(key, rawValue) {
    const tokens = getCurrentTokens();
    const nextTokens = { ...tokens, [key]: rawValue };
    const applied = applyThemeTokens(nextTokens);
    return applied[key] || "";
  }

  function updateOutput(entry, value) {
    if (!entry.output) return;
    if (entry.control.type === "color") return;
    if (entry.control.type === "rgba") {
      const alpha = readRgbaAlpha(String(value || ""), 1);
      entry.output.textContent = `a=${alpha.toFixed(2)}`;
      return;
    }
    if (entry.control.type === "grid-rgb") {
      entry.output.textContent = "rgb";
      return;
    }
    if (entry.control.type === "range") {
      const number = Number(value);
      if (!Number.isFinite(number)) return;
      const unit = entry.control.unit || "";
      entry.output.textContent = `${number.toFixed(decimalPlaces(entry.control.step))}${unit}`;
      return;
    }
    entry.output.textContent = String(value);
  }

  function syncInputs() {
    const tokens = getCurrentTokens();
    controlMap.forEach((entry) => {
      const value = tokens[entry.control.key];
      if (entry.control.type === "color") {
        const normalized = normalizeHexColor(value, "#ffffff");
        entry.input.value = normalized;
        if (entry.colorText) entry.colorText.value = normalized;
        updateOutput(entry, normalized);
        return;
      }
      if (entry.control.type === "rgba") {
        const textValue = String(value || "");
        const hex = parseColorLikeToHex(textValue, "#ffffff");
        entry.input.value = textValue;
        if (entry.colorPicker) entry.colorPicker.value = hex;
        updateOutput(entry, textValue);
        return;
      }
      if (entry.control.type === "grid-rgb") {
        const textValue = String(value || "");
        const hex = parseColorLikeToHex(textValue, "#ffffff");
        entry.input.value = textValue;
        if (entry.colorPicker) entry.colorPicker.value = hex;
        updateOutput(entry, textValue);
        return;
      } else if (entry.control.type === "range") {
        const numeric = Number(String(value).replace("px", ""));
        entry.input.value = Number.isFinite(numeric) ? String(numeric) : String(entry.control.min || 0);
      } else {
        entry.input.value = String(value || "");
      }
      updateOutput(entry, value);
    });
  }

  controls.forEach((control) => {
    const row = document.createElement("label");
    row.className = "theme-editor-control-row";
    const valueId = `theme-control-${control.key.replace(/[^a-z0-9_-]+/gi, "-")}`;

    if (control.type === "color") {
      row.innerHTML = `
        <span class="theme-editor-control-name">${control.label}</span>
        <input id="${valueId}" class="theme-editor-color-picker" type="color" />
        <input class="theme-editor-color-value" type="text" />
      `;
    } else if (control.type === "rgba" || control.type === "grid-rgb") {
      row.classList.add("theme-editor-control-row-color-text");
      row.innerHTML = `
        <span class="theme-editor-control-name">${control.label}</span>
        <span class="theme-editor-color-combo">
          <input id="${valueId}" class="theme-editor-color-picker" type="color" />
          <input class="theme-editor-color-value" type="text" placeholder="${control.placeholder || ""}" />
        </span>
        <output></output>
      `;
    } else if (control.type === "range") {
      row.innerHTML = `
        <span class="theme-editor-control-name">${control.label}</span>
        <input
          id="${valueId}"
          type="range"
          min="${control.min}"
          max="${control.max}"
          step="${control.step}"
        />
        <output></output>
      `;
    } else {
      row.innerHTML = `
        <span class="theme-editor-control-name">${control.label}</span>
        <input id="${valueId}" type="text" placeholder="${control.placeholder || ""}" />
        <output></output>
      `;
    }

    const colorPicker =
      control.type === "color" || control.type === "rgba" || control.type === "grid-rgb"
        ? row.querySelector(".theme-editor-color-picker")
        : null;
    const input = (() => {
      if (control.type === "color") return colorPicker;
      if (control.type === "rgba" || control.type === "grid-rgb")
        return row.querySelector(".theme-editor-color-value");
      return row.querySelector("input");
    })();
    const output = row.querySelector("output");
    const colorText =
      control.type === "color" ? row.querySelector(".theme-editor-color-value") : null;
    if (!input) return;

    if (control.type === "color") {
      input.addEventListener("input", () => {
        const normalized = applySingleToken(control.key, input.value);
        const hex = normalizeHexColor(normalized, "#ffffff");
        input.value = hex;
        if (colorText) colorText.value = hex;
      });

      colorText?.addEventListener("change", () => {
        const normalized = applySingleToken(control.key, colorText.value);
        const hex = normalizeHexColor(normalized, "#ffffff");
        input.value = hex;
        colorText.value = hex;
      });
    } else if (control.type === "rgba") {
      input.addEventListener("change", () => {
        const normalized = applySingleToken(control.key, input.value);
        input.value = String(normalized);
        if (colorPicker) colorPicker.value = parseColorLikeToHex(String(normalized), "#ffffff");
        updateOutput({ control, output }, normalized);
      });

      colorPicker?.addEventListener("input", () => {
        const alpha = readRgbaAlpha(input.value, 1);
        const rawValue = composeRgbaFromHex(colorPicker.value, alpha);
        const normalized = applySingleToken(control.key, rawValue);
        input.value = String(normalized);
        colorPicker.value = parseColorLikeToHex(String(normalized), colorPicker.value);
        updateOutput({ control, output }, normalized);
      });
    } else if (control.type === "grid-rgb") {
      input.addEventListener("change", () => {
        const normalized = applySingleToken(control.key, input.value);
        input.value = String(normalized);
        if (colorPicker) colorPicker.value = parseColorLikeToHex(String(normalized), "#ffffff");
        updateOutput({ control, output }, normalized);
      });

      colorPicker?.addEventListener("input", () => {
        const rawValue = hexToRgbSpace(colorPicker.value, "#ffffff");
        const normalized = applySingleToken(control.key, rawValue);
        input.value = String(normalized);
        colorPicker.value = parseColorLikeToHex(String(normalized), colorPicker.value);
        updateOutput({ control, output }, normalized);
      });
    } else {
      const eventName = control.type === "text" ? "change" : "input";
      input.addEventListener(eventName, () => {
        const rawValue = input.value;
        const normalized = applySingleToken(control.key, rawValue);
        if (control.type === "text") input.value = String(normalized);
        updateOutput({ control, output }, normalized);
      });
    }

    controlMap.set(control.key, { control, input, output, colorText, colorPicker });
    panelByTab.get(control.tab)?.appendChild(row);
  });

  tabButtons.forEach((button, index) => {
    button.addEventListener("click", () => setTab(button.dataset.tab || tabs[0].id));
    button.addEventListener("keydown", (event) => {
      let nextIndex = null;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % tabButtons.length;
      if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabButtons.length) % tabButtons.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = tabButtons.length - 1;
      if (nextIndex != null) {
        event.preventDefault();
        const nextButton = tabButtons[nextIndex];
        if (nextButton) setTab(nextButton.dataset.tab || tabs[0].id, true);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setTab(button.dataset.tab || tabs[0].id, true);
      }
    });
  });

  panel
    .querySelector('button[data-action="theme-dark"]')
    ?.addEventListener("click", () => void applyNamedTheme("dark"));
  panel
    .querySelector('button[data-action="theme-light"]')
    ?.addEventListener("click", () => void applyNamedTheme("light"));
  panel.querySelector('button[data-action="save"]')?.addEventListener("click", exportThemeToFile);
  panel.querySelector('button[data-action="reset"]')?.addEventListener("click", () => {
    applyThemeTokens(initialTokens);
    activeThemeName = initialThemeName || "custom";
    syncInputs();
  });

  setTab(activeTab);
  syncInputs();
}

function animateCounters() {
  const metrics = document.querySelectorAll(".metric-value[data-count]");
  if (!metrics.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const target = Number(el.dataset.count || 0);
        const start = performance.now();
        const duration = prefersReduced.matches ? 10 : 1400;

        function step(ts) {
          const progress = Math.min(1, (ts - start) / duration);
          el.textContent = String(Math.round(target * progress));
          if (progress < 1) requestAnimationFrame(step);
        }

        requestAnimationFrame(step);
        observer.unobserve(el);
      });
    },
    { threshold: 0.4 }
  );

  metrics.forEach((metric) => observer.observe(metric));
}

function setYear() {
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());
}

async function bootstrapBackground(
  backgroundTestMode = false,
  themeEditorMode = false,
  themeParamName = null
) {
  const baseTokens = readThemeTokensFromRoot();
  const loadedTheme = await loadThemeFromFile(themeParamName, baseTokens);
  const activeThemeName = loadedTheme?.name || themeParamName || "custom";

  const templates = await loadVectorTemplatesWithFallback();
  const engine = initBackground(canvas, engineConfig, templates);
  engine.setQuality(getMotionProfile());

  if (!backgroundTestMode) {
    setupMapInteractions(engine);
    setYear();
  } else {
    setupBackgroundTestControls(engine);
  }

  if (themeEditorMode) {
    setupThemeEditorControls(activeThemeName);
  }

  return engine;
}

const searchParams = new URLSearchParams(window.location.search);
let backgroundTestMode = isBackgroundTestMode(searchParams);
let themeEditorMode = isThemeEditorMode(searchParams);
if (backgroundTestMode && themeEditorMode) {
  console.warn("[mode] Ignoring both special modes because bgTest=1 and themeEditor=1 are both set.");
  backgroundTestMode = false;
  themeEditorMode = false;
}
const themeParamName = getThemeParamName(searchParams);

applyBackgroundTestMode(backgroundTestMode);
applyThemeEditorMode(themeEditorMode);
runIntroSequence({ backgroundTestMode, themeEditorMode });
bootstrapBackground(backgroundTestMode, themeEditorMode, themeParamName)
  .then(() => {
    if (backgroundTestMode) return;
    onIntroComplete(() => {
      animateCounters();
    });
  })
  .catch((error) => {
    console.warn("[bootstrap] failed:", error);
  });
