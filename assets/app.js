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
    },
    freeParticles: {
      ratioByProfile: {
        high: 0.35,
        medium: 0.3,
        low: 0.2,
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

function isClusterAdjacent(a, b) {
  return Math.abs(Number(a) - Number(b)) <= 1;
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
    const shuffledAnchors = shuffle(structureState.anchors);

    for (let i = 0; i < boundCount; i += 1) {
      const anchor = shuffledAnchors[i % shuffledAnchors.length];
      nextParticles.push({
        role: "bound",
        x: anchor.x + (Math.random() - 0.5) * 24,
        y: anchor.y + (Math.random() - 0.5) * 24,
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
      if (!isClusterAdjacent(a.cluster, b.cluster)) continue;

      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.hypot(dx, dy);
      if (dist >= cfg.linkDistance * 1.16) continue;

      const focusA = getFocusInfluence(a.x, a.y);
      const focusB = getFocusInfluence(b.x, b.y);
      let alpha = (0.058 + edge.strength * 0.084 + (focusA + focusB) * 0.08) * phaseFactor;
      alpha *= visibility;
      if (SECONDARY_LAYERS.has(edge.layer)) alpha *= 0.72;
      alpha = Math.min(mode.alphaCap, alpha);

      context.beginPath();
      context.strokeStyle = `rgba(101, 185, 210, ${alpha.toFixed(3)})`;
      context.lineWidth = 1;
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
        if (!isClusterAdjacent(a.cluster, b.cluster)) continue;

        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.hypot(dx, dy);
        const maxDist = cfg.linkDistance * 0.74;
        if (dist >= maxDist) continue;

        const alpha = Math.min(0.09, (1 - dist / maxDist) * 0.06);
        context.beginPath();
        context.strokeStyle = `rgba(94, 162, 187, ${alpha.toFixed(3)})`;
        context.lineWidth = 1;
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
    const weakDistance = mode.freeParticles.weakLinkDistance * (phaseState.phase === "hold" ? 1 : 0.86);
    const weakAlphaCap = mode.freeParticles.weakAlphaCap * phaseScale;

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
        context.strokeStyle = `rgba(122, 173, 192, ${alpha.toFixed(3)})`;
        context.lineWidth = 1;
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();
        links += 1;
      }
    }
  }

  function drawWeakFreeToBoundLinks(freeIndices, boundIndices, mode) {
    const phaseScale = freePhaseScale();
    const weakDistance = mode.freeParticles.weakLinkDistance * 0.9;
    const weakAlphaCap = mode.freeParticles.weakAlphaCap * 0.68 * phaseScale;
    const gate = 0.22 * phaseScale;

    for (let ii = 0; ii < freeIndices.length; ii += 1) {
      if (ii % 3 !== 0) continue;
      const freeParticle = particles[freeIndices[ii]];
      if (Math.random() > gate) continue;

      let nearest = null;
      let nearestDist = Number.POSITIVE_INFINITY;
      for (let jj = 0; jj < boundIndices.length; jj += 1) {
        const boundParticle = particles[boundIndices[jj]];
        if (!isClusterAdjacent(freeParticle.cluster, boundParticle.cluster)) continue;
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
      context.strokeStyle = `rgba(106, 165, 186, ${alpha.toFixed(3)})`;
      context.lineWidth = 1;
      context.moveTo(freeParticle.x, freeParticle.y);
      context.lineTo(nearest.x, nearest.y);
      context.stroke();
    }
  }

  function drawPoints(boundIndices, freeIndices) {
    const visibility = structureVisibility();
    const freePointScale = phaseState.phase === "hold" ? 1 : 0.86;

    boundIndices.forEach((index) => {
      const p = particles[index];
      const focus = getFocusInfluence(p.x, p.y);
      const alpha = (0.52 + focus * 0.36) * visibility;
      context.beginPath();
      context.fillStyle = `rgba(184, 231, 244, ${alpha.toFixed(3)})`;
      context.arc(p.x, p.y, p.radius + focus * 0.85, 0, Math.PI * 2);
      context.fill();
    });

    freeIndices.forEach((index) => {
      const p = particles[index];
      const focus = getFocusInfluence(p.x, p.y);
      const alpha = (0.28 + focus * 0.08) * freePointScale;
      context.beginPath();
      context.fillStyle = `rgba(147, 193, 211, ${alpha.toFixed(3)})`;
      context.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      context.fill();
    });
  }

  function drawFrame() {
    const cfg = profileConfig[profile];
    const mode = config.structureMode;

    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    const gradient = context.createLinearGradient(0, 0, window.innerWidth, window.innerHeight);
    gradient.addColorStop(0, "rgba(43, 210, 187, 0.09)");
    gradient.addColorStop(1, "rgba(255, 207, 102, 0.05)");
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
  }

  resizeCanvas();
  rebuildAnchors();
  createParticles();
  window.addEventListener("resize", handleResize);
  prefersReduced.addEventListener("change", handleMotionPreferenceChange);
  lastFrameTime = performance.now();
  rafId = requestAnimationFrame(tick);

  return {
    setQuality,
    setFocus,
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

async function bootstrapBackground() {
  const templates = await loadVectorTemplatesWithFallback();
  const engine = initBackground(canvas, engineConfig, templates);
  engine.setQuality(getMotionProfile());
  setupMapInteractions(engine);
}

bootstrapBackground();
animateCounters();
setYear();
