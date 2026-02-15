import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  loadTemplateManifest,
  loadSvgTemplate,
  parseSvgToTemplate,
  downsampleTemplateForProfile,
} from "../assets/vector-template-loader.js";
import {
  buildBridgeTemplateDetailed,
  buildIndustrialTemplateDetailed,
} from "../assets/background-templates.js";

const root = process.cwd();
const REQUIRED_LAYERS = {
  bridge: ["foundation", "supports", "beams", "truss", "braces"],
  industrial_frame: ["foundation", "supports", "beams", "braces", "roof"],
};

function read(filePath) {
  const full = path.join(root, filePath);
  assert.ok(fs.existsSync(full), `Missing file: ${filePath}`);
  return fs.readFileSync(full, "utf8");
}

function hasLayer(template, layer) {
  return template.points.some((point) => point.layer === layer);
}

function getPointById(template, id) {
  return template.points.find((point) => point.id === id) || null;
}

function assertValidTemplate(template, templateId) {
  assert.ok(template.points.length > 0, `${templateId} points are empty`);
  assert.ok(template.lineHints.length > 0, `${templateId} lineHints are empty`);
  for (const layer of REQUIRED_LAYERS[templateId]) {
    assert.ok(hasLayer(template, layer), `${templateId} missing layer: ${layer}`);
  }
  const pointIds = new Set(template.points.map((point) => point.id));
  for (const hint of template.lineHints) {
    assert.ok(pointIds.has(hint.from), `${templateId} lineHint.from is invalid`);
    assert.ok(pointIds.has(hint.to), `${templateId} lineHint.to is invalid`);
    assert.ok(hint.strength > 0, `${templateId} lineHint.strength must be > 0`);
  }
}

test("template manifest loads and contains bridge + industrial_frame", async () => {
  const rawManifest = read("assets/structures/index.json");
  const manifest = await loadTemplateManifest(
    "assets/structures/index.json",
    async () => ({
      ok: true,
      async json() {
        return JSON.parse(rawManifest);
      },
    })
  );

  assert.ok(Array.isArray(manifest.templates), "manifest.templates must be an array");
  const ids = manifest.templates.map((item) => item.id);
  assert.ok(ids.includes("bridge"), "manifest must include bridge");
  assert.ok(ids.includes("industrial_frame"), "manifest must include industrial_frame");
});

test("bridge SVG parses to a valid layered vector template", async () => {
  const bridgeSvg = read("assets/structures/bridge.svg");
  const template = await loadSvgTemplate(
    { id: "bridge", src: "assets/structures/bridge.svg" },
    { sampleStepPx: 10 },
    async () => ({
      ok: true,
      async text() {
        return bridgeSvg;
      },
    })
  );

  assert.equal(template.id, "bridge");
  assertValidTemplate(template, "bridge");
});

test("industrial SVG parses to a valid layered vector template", async () => {
  const industrialSvg = read("assets/structures/industrial_frame.svg");
  const template = await loadSvgTemplate(
    { id: "industrial_frame", src: "assets/structures/industrial_frame.svg" },
    { sampleStepPx: 10 },
    async () => ({
      ok: true,
      async text() {
        return industrialSvg;
      },
    })
  );

  assert.equal(template.id, "industrial_frame");
  assertValidTemplate(template, "industrial_frame");
});

test("parser supports line + polyline + path primitives", () => {
  const miniSvg = `
    <svg viewBox="0 0 100 100">
      <g data-layer="foundation" id="f">
        <line x1="10" y1="80" x2="90" y2="80" />
      </g>
      <g data-layer="supports" id="s">
        <polyline points="20,80 20,40 30,30" />
      </g>
      <g data-layer="beams" id="b">
        <path d="M20 40 L70 40 L80 30" />
      </g>
    </svg>
  `;
  const template = parseSvgToTemplate(miniSvg, { sampleStepPx: 8 });
  assert.ok(template.points.length > 0, "Primitive parser returned empty points");
  assert.ok(template.lineHints.length > 0, "Primitive parser returned empty lineHints");
  assert.ok(hasLayer(template, "foundation"), "line primitive was not parsed");
  assert.ok(hasLayer(template, "supports"), "polyline primitive was not parsed");
  assert.ok(hasLayer(template, "beams"), "path primitive was not parsed");
});

test("procedural templates remain available as fallback source", () => {
  const bridge = buildBridgeTemplateDetailed();
  const industrial = buildIndustrialTemplateDetailed();
  assertValidTemplate(bridge, "bridge");
  assertValidTemplate(industrial, "industrial_frame");
});

test("downsample keeps required layers and valid line hints", async () => {
  const bridgeSvg = read("assets/structures/bridge.svg");
  const parsed = await loadSvgTemplate(
    { id: "bridge", src: "assets/structures/bridge.svg" },
    { sampleStepPx: 10 },
    async () => ({
      ok: true,
      async text() {
        return bridgeSvg;
      },
    })
  );

  const sampled = downsampleTemplateForProfile(parsed, "medium", {
    targetPointCount: 72,
    sampleStepPxByProfile: { high: 10, medium: 11, low: 13, reduced: 14 },
    minLayerShare: {
      foundation: 0.15,
      supports: 0.2,
      beams: 0.22,
      truss: 0.1,
      braces: 0.12,
      roof: 0.1,
    },
    preserveConnectivity: true,
  });

  assert.ok(sampled.points.length > 0, "downsample returned empty points");
  assert.ok(sampled.lineHints.length > 0, "downsample returned empty line hints");
  for (const layer of REQUIRED_LAYERS.bridge) {
    assert.ok(hasLayer(sampled, layer), `downsample dropped required bridge layer: ${layer}`);
  }

  const pointIds = new Set(sampled.points.map((point) => point.id));
  for (const hint of sampled.lineHints) {
    assert.ok(pointIds.has(hint.from), "line hint from is missing after downsample");
    assert.ok(pointIds.has(hint.to), "line hint to is missing after downsample");
  }
});

test("downsample keeps non-empty core connectivity", async () => {
  const industrialSvg = read("assets/structures/industrial_frame.svg");
  const parsed = await loadSvgTemplate(
    { id: "industrial_frame", src: "assets/structures/industrial_frame.svg" },
    { sampleStepPx: 10 },
    async () => ({
      ok: true,
      async text() {
        return industrialSvg;
      },
    })
  );

  const sampled = downsampleTemplateForProfile(parsed, "low", {
    targetPointCount: 48,
    sampleStepPxByProfile: { high: 10, medium: 11, low: 13, reduced: 14 },
    preserveConnectivity: true,
  });

  const coreLayers = new Set(["foundation", "supports", "beams"]);
  const coreEdges = sampled.lineHints.filter((hint) => {
    const from = getPointById(sampled, hint.from);
    const to = getPointById(sampled, hint.to);
    return from && to && coreLayers.has(from.layer) && coreLayers.has(to.layer);
  });

  assert.ok(coreEdges.length > 0, "core connectivity disappeared after downsample");
});
