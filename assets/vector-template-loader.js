const LAYER_WEIGHTS = {
  foundation: 1.05,
  supports: 1,
  beams: 0.94,
  truss: 0.88,
  braces: 0.82,
  roof: 0.9,
};

const SUPPORTED_LAYERS = new Set([
  "foundation",
  "supports",
  "beams",
  "truss",
  "braces",
  "roof",
]);

const DEFAULT_SAMPLING_CONFIG = {
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
};

function getAttr(attrs, name) {
  const regex = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i");
  const match = attrs.match(regex);
  return match ? match[1] : "";
}

function getNumAttr(attrs, name) {
  const value = getAttr(attrs, name);
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clusterFromNx(nx) {
  if (nx < 0.2) return "0";
  if (nx < 0.4) return "1";
  if (nx < 0.6) return "2";
  if (nx < 0.8) return "3";
  return "4";
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function stableHash(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function parseViewBox(svgText) {
  const svgTagMatch = svgText.match(/<svg\b([^>]*)>/i);
  if (!svgTagMatch) return null;
  const attrs = svgTagMatch[1] || "";
  const viewBoxRaw = getAttr(attrs, "viewBox");
  if (!viewBoxRaw) return null;
  const parts = viewBoxRaw
    .trim()
    .split(/[,\s]+/)
    .map(Number)
    .filter((value) => Number.isFinite(value));
  if (parts.length !== 4) return null;
  const [minX, minY, width, height] = parts;
  if (width <= 0 || height <= 0) return null;
  return { minX, minY, width, height };
}

function parsePointsAttr(pointsRaw) {
  if (!pointsRaw) return [];
  const numbers = pointsRaw
    .trim()
    .split(/[,\s]+/)
    .map(Number)
    .filter((value) => Number.isFinite(value));
  const points = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    points.push({ x: numbers[i], y: numbers[i + 1] });
  }
  return points;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function densifyPolyline(points, stepPx) {
  if (points.length <= 1) return points.slice();
  const step = Math.max(2, stepPx || 12);
  const dense = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i];
    const to = points[i + 1];
    const len = distance(from, to);
    const segments = Math.max(1, Math.ceil(len / step));
    for (let s = 0; s < segments; s += 1) {
      const t = s / segments;
      dense.push({
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
      });
    }
  }
  dense.push(points[points.length - 1]);
  return dense;
}

function tokenizePathData(d) {
  return d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
}

function readNumber(tokens, state) {
  const token = tokens[state.index];
  if (token == null) return null;
  const value = Number(token);
  if (!Number.isFinite(value)) return null;
  state.index += 1;
  return value;
}

function extractPathVertices(pathData) {
  const tokens = tokenizePathData(pathData);
  const points = [];
  const state = { index: 0 };
  let cmd = "";
  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;

  while (state.index < tokens.length) {
    const token = tokens[state.index];
    if (/^[a-zA-Z]$/.test(token)) {
      cmd = token;
      state.index += 1;
    } else if (!cmd) {
      state.index += 1;
      continue;
    }

    if (cmd === "M" || cmd === "m") {
      let first = true;
      while (state.index < tokens.length && !/^[a-zA-Z]$/.test(tokens[state.index])) {
        const x = readNumber(tokens, state);
        const y = readNumber(tokens, state);
        if (x == null || y == null) break;
        if (cmd === "m") {
          currentX += x;
          currentY += y;
        } else {
          currentX = x;
          currentY = y;
        }
        if (first) {
          startX = currentX;
          startY = currentY;
          first = false;
        }
        points.push({ x: currentX, y: currentY });
        cmd = cmd === "m" ? "l" : "L";
      }
      continue;
    }

    if (cmd === "L" || cmd === "l") {
      while (state.index < tokens.length && !/^[a-zA-Z]$/.test(tokens[state.index])) {
        const x = readNumber(tokens, state);
        const y = readNumber(tokens, state);
        if (x == null || y == null) break;
        if (cmd === "l") {
          currentX += x;
          currentY += y;
        } else {
          currentX = x;
          currentY = y;
        }
        points.push({ x: currentX, y: currentY });
      }
      continue;
    }

    if (cmd === "H" || cmd === "h") {
      while (state.index < tokens.length && !/^[a-zA-Z]$/.test(tokens[state.index])) {
        const x = readNumber(tokens, state);
        if (x == null) break;
        currentX = cmd === "h" ? currentX + x : x;
        points.push({ x: currentX, y: currentY });
      }
      continue;
    }

    if (cmd === "V" || cmd === "v") {
      while (state.index < tokens.length && !/^[a-zA-Z]$/.test(tokens[state.index])) {
        const y = readNumber(tokens, state);
        if (y == null) break;
        currentY = cmd === "v" ? currentY + y : y;
        points.push({ x: currentX, y: currentY });
      }
      continue;
    }

    if (cmd === "Z" || cmd === "z") {
      points.push({ x: startX, y: startY });
      continue;
    }

    while (state.index < tokens.length && !/^[a-zA-Z]$/.test(tokens[state.index])) {
      state.index += 1;
    }
  }

  return points;
}

function samplePrimitive(type, attrs, sampleStepPx) {
  if (type === "line") {
    const x1 = getNumAttr(attrs, "x1");
    const y1 = getNumAttr(attrs, "y1");
    const x2 = getNumAttr(attrs, "x2");
    const y2 = getNumAttr(attrs, "y2");
    if ([x1, y1, x2, y2].some((value) => value == null)) return [];
    return densifyPolyline(
      [
        { x: x1, y: y1 },
        { x: x2, y: y2 },
      ],
      sampleStepPx
    );
  }

  if (type === "polyline") {
    const points = parsePointsAttr(getAttr(attrs, "points"));
    return densifyPolyline(points, sampleStepPx);
  }

  if (type === "path") {
    const d = getAttr(attrs, "d");
    if (!d) return [];
    return densifyPolyline(extractPathVertices(d), sampleStepPx);
  }

  return [];
}

function parseGroupPrimitives(groupContent, supportedPrimitives) {
  const primitives = [];
  const regex = /<(line|polyline|path)\b([^>]*?)\/?>/gi;
  let match;
  while ((match = regex.exec(groupContent))) {
    const type = (match[1] || "").toLowerCase();
    if (!supportedPrimitives.includes(type)) continue;
    primitives.push({ type, attrs: match[2] || "" });
  }
  return primitives;
}

export function parseSvgToTemplate(svgText, options = {}) {
  const settings = {
    supportedPrimitives: ["line", "polyline", "path"],
    sampleStepPx: 12,
    templateId: null,
    ...options,
  };

  const viewBox = parseViewBox(svgText);
  const groupRegex = /<g\b([^>]*\bdata-layer=["'][^"']+["'][^>]*)>([\s\S]*?)<\/g>/gi;
  const rawPoints = [];
  const rawPolylines = [];
  let groupMatch;
  let groupIndex = 0;

  while ((groupMatch = groupRegex.exec(svgText))) {
    const groupAttrs = groupMatch[1] || "";
    const groupContent = groupMatch[2] || "";
    const layer = getAttr(groupAttrs, "data-layer");
    if (!SUPPORTED_LAYERS.has(layer)) {
      groupIndex += 1;
      continue;
    }
    const groupId = getAttr(groupAttrs, "id") || `group_${groupIndex}`;
    const primitives = parseGroupPrimitives(groupContent, settings.supportedPrimitives);

    primitives.forEach((primitive, primitiveIndex) => {
      const sampled = samplePrimitive(primitive.type, primitive.attrs, settings.sampleStepPx);
      if (sampled.length < 2) return;
      const semanticGroup = `${layer}:${groupId}:${primitive.type}_${primitiveIndex}`;
      const lineIndices = [];
      sampled.forEach((point) => {
        rawPoints.push({
          x: point.x,
          y: point.y,
          layer,
          semanticGroup,
          weight: LAYER_WEIGHTS[layer] || 1,
        });
        lineIndices.push(rawPoints.length - 1);
      });
      rawPolylines.push({ layer, indices: lineIndices });
    });

    groupIndex += 1;
  }

  if (!rawPoints.length) {
    throw new Error("No supported vector geometry found in SVG template.");
  }

  const minX = viewBox
    ? viewBox.minX
    : Math.min(...rawPoints.map((point) => point.x));
  const minY = viewBox
    ? viewBox.minY
    : Math.min(...rawPoints.map((point) => point.y));
  const width = viewBox
    ? viewBox.width
    : Math.max(1, Math.max(...rawPoints.map((point) => point.x)) - minX);
  const height = viewBox
    ? viewBox.height
    : Math.max(1, Math.max(...rawPoints.map((point) => point.y)) - minY);

  const points = rawPoints.map((point, index) => {
    const nx = clamp01((point.x - minX) / width);
    const ny = clamp01((point.y - minY) / height);
    return {
      id: `anchor-${index}`,
      nx,
      ny,
      layer: point.layer,
      semanticGroup: point.semanticGroup,
      cluster: clusterFromNx(nx),
      weight: point.weight,
    };
  });

  const lineHints = [];
  const seenPairs = new Set();
  for (const polyline of rawPolylines) {
    for (let i = 0; i < polyline.indices.length - 1; i += 1) {
      const fromIndex = polyline.indices[i];
      const toIndex = polyline.indices[i + 1];
      const fromId = points[fromIndex].id;
      const toId = points[toIndex].id;
      const key = pairKey(fromId, toId);
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      lineHints.push({
        from: fromId,
        to: toId,
        strength: LAYER_WEIGHTS[polyline.layer] || 0.8,
      });
    }
  }

  return {
    id: settings.templateId || "vector_template",
    points,
    lineHints,
  };
}

function normalizeSamplingConfig(config = {}) {
  return {
    sampleStepPxByProfile: {
      ...DEFAULT_SAMPLING_CONFIG.sampleStepPxByProfile,
      ...(config.sampleStepPxByProfile || {}),
    },
    minLayerShare: {
      ...DEFAULT_SAMPLING_CONFIG.minLayerShare,
      ...(config.minLayerShare || {}),
    },
    preserveConnectivity:
      typeof config.preserveConnectivity === "boolean"
        ? config.preserveConnectivity
        : DEFAULT_SAMPLING_CONFIG.preserveConnectivity,
  };
}

function buildDegreeMap(lineHints) {
  const degree = new Map();
  lineHints.forEach((hint) => {
    degree.set(hint.from, (degree.get(hint.from) || 0) + 1);
    degree.set(hint.to, (degree.get(hint.to) || 0) + 1);
  });
  return degree;
}

function filterValidLineHints(lineHints, pointIds) {
  const dedupe = new Set();
  const valid = [];
  lineHints.forEach((hint) => {
    if (!pointIds.has(hint.from) || !pointIds.has(hint.to)) return;
    if (hint.from === hint.to) return;
    const key = pairKey(hint.from, hint.to);
    if (dedupe.has(key)) return;
    dedupe.add(key);
    valid.push(hint);
  });
  return valid;
}

function buildLayerQuotas(pointsByLayer, targetPointCount, minLayerShare) {
  const layers = Object.keys(pointsByLayer);
  const quotas = new Map();
  if (!layers.length) return quotas;

  let assigned = 0;
  layers.forEach((layer) => {
    const available = pointsByLayer[layer].length;
    const minShare = minLayerShare[layer] || 0;
    const quota = Math.min(
      available,
      Math.max(1, Math.floor(targetPointCount * minShare))
    );
    quotas.set(layer, quota);
    assigned += quota;
  });

  while (assigned > targetPointCount) {
    let reduced = false;
    const sortable = layers
      .map((layer) => ({ layer, quota: quotas.get(layer) || 0 }))
      .sort((a, b) => b.quota - a.quota);
    for (const entry of sortable) {
      if ((quotas.get(entry.layer) || 0) > 1) {
        quotas.set(entry.layer, (quotas.get(entry.layer) || 0) - 1);
        assigned -= 1;
        reduced = true;
        if (assigned <= targetPointCount) break;
      }
    }
    if (!reduced) break;
  }

  while (assigned < targetPointCount) {
    let bestLayer = null;
    let bestRemaining = -1;
    layers.forEach((layer) => {
      const available = pointsByLayer[layer].length;
      const quota = quotas.get(layer) || 0;
      const remaining = available - quota;
      if (remaining > bestRemaining) {
        bestRemaining = remaining;
        bestLayer = layer;
      }
    });
    if (!bestLayer || bestRemaining <= 0) break;
    quotas.set(bestLayer, (quotas.get(bestLayer) || 0) + 1);
    assigned += 1;
  }

  return quotas;
}

function rankPoints(points, degreeMap) {
  return points
    .slice()
    .sort((a, b) => {
      const da = degreeMap.get(a.id) || 0;
      const db = degreeMap.get(b.id) || 0;
      if (db !== da) return db - da;
      if (b.weight !== a.weight) return b.weight - a.weight;
      return stableHash(a.id) - stableHash(b.id);
    });
}

function pickLayerPoints(points, quota, degreeMap) {
  if (quota <= 0) return [];
  const bySemanticGroup = new Map();
  points.forEach((point) => {
    const key = point.semanticGroup || point.layer || "default";
    if (!bySemanticGroup.has(key)) bySemanticGroup.set(key, []);
    bySemanticGroup.get(key).push(point);
  });

  const groups = Array.from(bySemanticGroup.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, groupPoints]) => ({
      key,
      points: rankPoints(groupPoints, degreeMap),
      index: 0,
    }));

  const picked = [];
  while (picked.length < quota) {
    let progressed = false;
    for (const group of groups) {
      if (picked.length >= quota) break;
      if (group.index >= group.points.length) continue;
      picked.push(group.points[group.index]);
      group.index += 1;
      progressed = true;
    }
    if (!progressed) break;
  }

  if (picked.length >= quota) return picked;
  const remainder = rankPoints(points, degreeMap).filter(
    (point) => !picked.some((pickedPoint) => pickedPoint.id === point.id)
  );
  for (const point of remainder) {
    if (picked.length >= quota) break;
    picked.push(point);
  }
  return picked;
}

function ensureConnectivitySelection(
  selectedIds,
  lineHints,
  targetPointCount,
  preserveConnectivity
) {
  if (!preserveConnectivity || selectedIds.size >= targetPointCount) return;
  const rankedHints = lineHints.slice().sort((a, b) => b.strength - a.strength);
  for (const hint of rankedHints) {
    if (selectedIds.size >= targetPointCount) break;
    const fromSelected = selectedIds.has(hint.from);
    const toSelected = selectedIds.has(hint.to);
    if (fromSelected && toSelected) continue;
    if (fromSelected || toSelected) {
      selectedIds.add(fromSelected ? hint.to : hint.from);
    }
  }
}

function removeIsolatedPoints(points, lineHints) {
  const degree = buildDegreeMap(lineHints);
  const layerCounts = new Map();
  points.forEach((point) => {
    layerCounts.set(point.layer, (layerCounts.get(point.layer) || 0) + 1);
  });

  const kept = [];
  points.forEach((point) => {
    const deg = degree.get(point.id) || 0;
    const layerCount = layerCounts.get(point.layer) || 0;
    const keep = deg > 0 || layerCount <= 1;
    if (!keep) {
      layerCounts.set(point.layer, layerCount - 1);
      return;
    }
    kept.push(point);
  });
  return kept;
}

export function downsampleTemplateForProfile(template, profile, config = {}) {
  if (!template || !Array.isArray(template.points) || !Array.isArray(template.lineHints)) {
    throw new Error("Invalid template input for downsampleTemplateForProfile.");
  }

  const sampling = normalizeSamplingConfig(config);
  const maxTargetFromConfig = Number(config.targetPointCount);
  const fallbackTarget = Math.max(
    24,
    Math.floor(
      template.points.length * (profile === "high" ? 0.34 : profile === "medium" ? 0.29 : 0.22)
    )
  );
  const targetPointCount = Math.min(
    template.points.length,
    Number.isFinite(maxTargetFromConfig) && maxTargetFromConfig > 0
      ? Math.floor(maxTargetFromConfig)
      : fallbackTarget
  );

  const pointIds = new Set(template.points.map((point) => point.id));
  const validHints = filterValidLineHints(template.lineHints, pointIds);
  if (targetPointCount >= template.points.length) {
    return {
      ...template,
      points: template.points.slice(),
      lineHints: validHints,
    };
  }

  const degreeMap = buildDegreeMap(validHints);
  const pointsByLayer = {};
  template.points.forEach((point) => {
    if (!pointsByLayer[point.layer]) pointsByLayer[point.layer] = [];
    pointsByLayer[point.layer].push(point);
  });

  const quotas = buildLayerQuotas(
    pointsByLayer,
    targetPointCount,
    sampling.minLayerShare
  );
  const selectedIds = new Set();
  Object.keys(pointsByLayer).forEach((layer) => {
    const quota = quotas.get(layer) || 0;
    const picks = pickLayerPoints(pointsByLayer[layer], quota, degreeMap);
    picks.forEach((point) => selectedIds.add(point.id));
  });

  ensureConnectivitySelection(
    selectedIds,
    validHints,
    targetPointCount,
    sampling.preserveConnectivity
  );

  if (selectedIds.size > targetPointCount) {
    const rankedSelected = rankPoints(
      template.points.filter((point) => selectedIds.has(point.id)),
      degreeMap
    );
    selectedIds.clear();
    rankedSelected.slice(0, targetPointCount).forEach((point) => selectedIds.add(point.id));
  }

  const selectedPoints = template.points.filter((point) => selectedIds.has(point.id));
  const filteredHints = filterValidLineHints(validHints, selectedIds);
  const nonIsolatedPoints = removeIsolatedPoints(selectedPoints, filteredHints);
  const nonIsolatedIds = new Set(nonIsolatedPoints.map((point) => point.id));
  const nonIsolatedHints = filterValidLineHints(filteredHints, nonIsolatedIds);

  const requiredLayers = new Set(template.points.map((point) => point.layer));
  const keptLayers = new Set(nonIsolatedPoints.map((point) => point.layer));
  requiredLayers.forEach((layer) => {
    if (keptLayers.has(layer)) return;
    const fallbackPoint = rankPoints(pointsByLayer[layer] || [], degreeMap)[0];
    if (!fallbackPoint) return;
    nonIsolatedPoints.push(fallbackPoint);
    nonIsolatedIds.add(fallbackPoint.id);
    console.warn(
      `[vector-template-loader] downsample layer coverage fallback: ${template.id} -> ${layer}`
    );
  });

  return {
    ...template,
    points: nonIsolatedPoints,
    lineHints: filterValidLineHints(validHints, new Set(nonIsolatedPoints.map((p) => p.id))),
  };
}

export async function loadTemplateManifest(url, fetchImpl = fetch) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Failed to load template manifest: ${response.status}`);
  }
  const manifest = await response.json();
  if (!manifest || !Array.isArray(manifest.templates)) {
    throw new Error("Invalid template manifest: templates array is missing.");
  }
  return manifest;
}

export async function loadSvgTemplate(item, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(item.src);
  if (!response.ok) {
    throw new Error(`Failed to load SVG template ${item.id}: ${response.status}`);
  }
  const svgText = await response.text();
  return parseSvgToTemplate(svgText, { ...options, templateId: item.id });
}
