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
      sourceIndex: index,
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
    stitchingEnabled:
      typeof config.stitchingEnabled === "boolean"
        ? config.stitchingEnabled
        : DEFAULT_SAMPLING_CONFIG.stitchingEnabled,
    stitchMaxEdgesByProfile: {
      ...DEFAULT_SAMPLING_CONFIG.stitchMaxEdgesByProfile,
      ...(config.stitchMaxEdgesByProfile || {}),
    },
    stitchMaxDistanceNxyByProfile: {
      ...DEFAULT_SAMPLING_CONFIG.stitchMaxDistanceNxyByProfile,
      ...(config.stitchMaxDistanceNxyByProfile || {}),
    },
  };
}

function pointSortIndex(point) {
  if (Number.isFinite(point.sourceIndex)) return point.sourceIndex;
  if (typeof point.id === "string") {
    const suffix = Number(point.id.replace(/^anchor-/, ""));
    if (Number.isFinite(suffix)) return suffix;
  }
  return stableHash(point.id || "");
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

function sortPointsBySource(points) {
  return points.slice().sort((a, b) => pointSortIndex(a) - pointSortIndex(b));
}

function buildLayerQuotas(pointsByLayer, targetPointCount, minLayerShare) {
  const layers = Object.keys(pointsByLayer);
  const quotas = new Map();
  if (!layers.length) return quotas;

  const minimumPerLayer = targetPointCount >= layers.length * 2 ? 2 : 1;
  const minimumByLayer = new Map();
  let assigned = 0;
  layers.forEach((layer) => {
    const available = pointsByLayer[layer].length;
    const minShare = minLayerShare[layer] || 0;
    const base = Math.floor(targetPointCount * minShare);
    const minQuota = Math.min(available, minimumPerLayer);
    const quota = Math.min(available, Math.max(minQuota, base));
    minimumByLayer.set(layer, minQuota);
    quotas.set(layer, quota);
    assigned += quota;
  });

  while (assigned > targetPointCount) {
    let reduced = false;
    const sortable = layers
      .map((layer) => ({ layer, quota: quotas.get(layer) || 0 }))
      .sort((a, b) => b.quota - a.quota);
    for (const entry of sortable) {
      const minQuota = minimumByLayer.get(entry.layer) || 1;
      if ((quotas.get(entry.layer) || 0) > minQuota) {
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

function splitSemanticGroups(points) {
  const groups = new Map();
  points.forEach((point) => {
    const key = point.semanticGroup || point.layer || "default";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(point);
  });
  return Array.from(groups.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, groupPoints]) => ({
      key,
      points: sortPointsBySource(groupPoints),
    }));
}

function buildGroupQuotas(groups, quota) {
  const quotas = new Map(groups.map((group) => [group.key, 0]));
  if (!groups.length || quota <= 0) return quotas;

  const maxPickable = groups.reduce((acc, group) => acc + group.points.length, 0);
  const target = Math.min(quota, maxPickable);
  let assigned = 0;
  while (assigned < target) {
    let bestGroup = null;
    let bestScore = -1;
    groups.forEach((group) => {
      const current = quotas.get(group.key) || 0;
      const remaining = group.points.length - current;
      if (remaining <= 0) return;
      const score = remaining / (current + 1);
      if (score > bestScore) {
        bestScore = score;
        bestGroup = group.key;
      }
    });
    if (!bestGroup) break;
    quotas.set(bestGroup, (quotas.get(bestGroup) || 0) + 1);
    assigned += 1;
  }
  return quotas;
}

function uniqueRoundedIndices(length, count) {
  if (count <= 0 || length <= 0) return [];
  if (count >= length) return Array.from({ length }, (_, i) => i);

  const picks = new Set();
  if (count === 1) {
    picks.add(Math.floor((length - 1) / 2));
  } else {
    for (let i = 0; i < count; i += 1) {
      const idx = Math.round((i * (length - 1)) / (count - 1));
      picks.add(Math.max(0, Math.min(length - 1, idx)));
    }
  }

  if (picks.size >= count) {
    return Array.from(picks).sort((a, b) => a - b);
  }

  for (let i = 0; i < length && picks.size < count; i += 1) {
    picks.add(i);
  }
  return Array.from(picks).sort((a, b) => a - b);
}

function pickUniformFromGroup(groupPoints, count) {
  const points = sortPointsBySource(groupPoints);
  const indices = uniqueRoundedIndices(points.length, count);
  return indices.map((index) => points[index]);
}

function selectLayerPoints(points, quota) {
  if (quota <= 0 || !points.length) return [];
  const groups = splitSemanticGroups(points);
  const groupQuotas = buildGroupQuotas(groups, quota);
  const selected = [];
  groups.forEach((group) => {
    const groupQuota = groupQuotas.get(group.key) || 0;
    if (groupQuota <= 0) return;
    selected.push(...pickUniformFromGroup(group.points, groupQuota));
  });
  return sortPointsBySource(selected);
}

function fillSelectionToTarget(selectedIds, pointsByLayer, targetPointCount) {
  if (selectedIds.size >= targetPointCount) return;
  const layers = Object.keys(pointsByLayer);
  while (selectedIds.size < targetPointCount) {
    let progressed = false;
    for (const layer of layers) {
      if (selectedIds.size >= targetPointCount) break;
      const candidate = pointsByLayer[layer].find((point) => !selectedIds.has(point.id));
      if (!candidate) continue;
      selectedIds.add(candidate.id);
      progressed = true;
    }
    if (!progressed) break;
  }
}

function enforceLayerCoverage(selectedIds, pointsByLayer, targetPointCount) {
  const layers = Object.keys(pointsByLayer);
  const minimumPerLayer = targetPointCount >= layers.length * 2 ? 2 : 1;
  layers.forEach((layer) => {
    const layerPoints = pointsByLayer[layer];
    const selectedInLayer = layerPoints.filter((point) => selectedIds.has(point.id)).length;
    const needed = Math.min(layerPoints.length, minimumPerLayer) - selectedInLayer;
    if (needed <= 0) return;
    const additions = pickUniformFromGroup(layerPoints, selectedInLayer + needed)
      .filter((point) => !selectedIds.has(point.id))
      .slice(0, needed);
    additions.forEach((point) => selectedIds.add(point.id));
  });
}

function trimSelectionToTarget(selectedIds, pointsByLayer, targetPointCount) {
  if (selectedIds.size <= targetPointCount) return;
  const layers = Object.keys(pointsByLayer);
  const minimumPerLayer = targetPointCount >= layers.length * 2 ? 2 : 1;
  const selectedByLayer = new Map();
  layers.forEach((layer) => {
    selectedByLayer.set(
      layer,
      pointsByLayer[layer].filter((point) => selectedIds.has(point.id))
    );
  });

  while (selectedIds.size > targetPointCount) {
    let removed = false;
    const candidates = layers
      .map((layer) => ({ layer, points: selectedByLayer.get(layer) || [] }))
      .sort((a, b) => b.points.length - a.points.length);
    for (const candidate of candidates) {
      const minCount = Math.min(pointsByLayer[candidate.layer].length, minimumPerLayer);
      if (candidate.points.length <= minCount) continue;
      const point = candidate.points[candidate.points.length - 1];
      selectedIds.delete(point.id);
      candidate.points.pop();
      removed = true;
      break;
    }
    if (!removed) break;
  }
}

function buildGroupLineHints(points) {
  const groups = splitSemanticGroups(points);
  const hints = [];
  const seen = new Set();
  groups.forEach((group) => {
    for (let i = 0; i < group.points.length - 1; i += 1) {
      const from = group.points[i];
      const to = group.points[i + 1];
      const key = pairKey(from.id, to.id);
      if (seen.has(key)) continue;
      seen.add(key);
      hints.push({
        from: from.id,
        to: to.id,
        strength: LAYER_WEIGHTS[from.layer] || 0.75,
      });
    }
  });
  return hints;
}

function buildAdjacency(points, lineHints) {
  const adjacency = new Map(points.map((point) => [point.id, new Set()]));
  lineHints.forEach((hint) => {
    if (!adjacency.has(hint.from) || !adjacency.has(hint.to)) return;
    adjacency.get(hint.from).add(hint.to);
    adjacency.get(hint.to).add(hint.from);
  });
  return adjacency;
}

function collectComponents(points, lineHints) {
  const pointById = new Map(points.map((point) => [point.id, point]));
  const adjacency = buildAdjacency(points, lineHints);
  const visited = new Set();
  const components = [];
  points.forEach((point) => {
    if (visited.has(point.id)) return;
    const stack = [point.id];
    visited.add(point.id);
    const ids = [];
    while (stack.length) {
      const current = stack.pop();
      ids.push(current);
      for (const next of adjacency.get(current) || []) {
        if (visited.has(next)) continue;
        visited.add(next);
        stack.push(next);
      }
    }
    components.push({
      ids,
      points: ids.map((id) => pointById.get(id)).filter(Boolean),
    });
  });
  return components.sort((a, b) => b.ids.length - a.ids.length);
}

function nearestComponentPair(primaryPoints, secondaryPoints) {
  let best = null;
  for (const a of primaryPoints) {
    for (const b of secondaryPoints) {
      const dx = a.nx - b.nx;
      const dy = a.ny - b.ny;
      const dist = Math.hypot(dx, dy);
      if (!best || dist < best.dist) {
        best = { from: a.id, to: b.id, dist };
      }
    }
  }
  return best;
}

function applyLightStitching(points, lineHints, profile, sampling) {
  if (!sampling.stitchingEnabled) return lineHints;
  const maxEdges = sampling.stitchMaxEdgesByProfile[profile] || 0;
  const maxDistance = sampling.stitchMaxDistanceNxyByProfile[profile] || 0;
  if (maxEdges <= 0 || maxDistance <= 0) return lineHints;

  const pointIds = new Set(points.map((point) => point.id));
  const stitched = lineHints.slice();
  let used = 0;

  while (used < maxEdges) {
    const components = collectComponents(points, filterValidLineHints(stitched, pointIds));
    if (components.length <= 1) break;
    const primary = components[0];
    let best = null;
    for (let i = 1; i < components.length; i += 1) {
      const pair = nearestComponentPair(primary.points, components[i].points);
      if (!pair) continue;
      if (!best || pair.dist < best.dist) {
        best = pair;
      }
    }
    if (!best || best.dist > maxDistance) break;
    stitched.push({
      from: best.from,
      to: best.to,
      strength: 0.34,
    });
    used += 1;
  }

  return filterValidLineHints(stitched, pointIds);
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
      template.points.length * (profile === "high" ? 0.42 : profile === "medium" ? 0.36 : 0.28)
    )
  );
  const requestedTarget = Math.min(
    template.points.length,
    Number.isFinite(maxTargetFromConfig) && maxTargetFromConfig > 0
      ? Math.floor(maxTargetFromConfig)
      : fallbackTarget
  );
  const sampleStep = sampling.sampleStepPxByProfile[profile] || 10;
  const stepScale = sampleStep <= 10 ? 1 + (10 - sampleStep) * 0.02 : 1 - (sampleStep - 10) * 0.04;
  const targetPointCount = Math.max(
    16,
    Math.min(template.points.length, Math.floor(requestedTarget * Math.max(0.6, stepScale)))
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

  const pointsByLayer = {};
  template.points.forEach((point) => {
    if (!pointsByLayer[point.layer]) pointsByLayer[point.layer] = [];
    pointsByLayer[point.layer].push(point);
  });
  Object.keys(pointsByLayer).forEach((layer) => {
    pointsByLayer[layer] = sortPointsBySource(pointsByLayer[layer]);
  });

  const quotas = buildLayerQuotas(
    pointsByLayer,
    targetPointCount,
    sampling.minLayerShare
  );
  const selectedIds = new Set();
  Object.keys(pointsByLayer).forEach((layer) => {
    const quota = quotas.get(layer) || 0;
    const picks = selectLayerPoints(pointsByLayer[layer], quota);
    picks.forEach((point) => selectedIds.add(point.id));
  });

  enforceLayerCoverage(selectedIds, pointsByLayer, targetPointCount);
  fillSelectionToTarget(selectedIds, pointsByLayer, targetPointCount);
  trimSelectionToTarget(selectedIds, pointsByLayer, targetPointCount);

  const selectedPoints = sortPointsBySource(
    template.points.filter((point) => selectedIds.has(point.id))
  );
  const reconstructedHints = buildGroupLineHints(selectedPoints);
  const carriedHints = sampling.preserveConnectivity
    ? filterValidLineHints(validHints, selectedIds)
    : [];
  const mergedHints = filterValidLineHints(
    [...reconstructedHints, ...carriedHints],
    new Set(selectedPoints.map((point) => point.id))
  );
  const stitchedHints = applyLightStitching(
    selectedPoints,
    mergedHints,
    profile,
    sampling
  );

  return {
    ...template,
    points: selectedPoints,
    lineHints: stitchedHints,
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
