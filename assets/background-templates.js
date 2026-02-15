const DEFAULT_WEIGHT = 1;

const LAYER_STRENGTH = {
  foundation: 0.95,
  supports: 0.92,
  beams: 0.9,
  truss: 0.8,
  braces: 0.72,
  roof: 0.86,
};

const MORPH_LAYER_RULES = {
  foundation: ["foundation"],
  supports: ["supports"],
  beams: ["beams", "roof", "supports"],
  truss: ["beams", "roof", "braces"],
  braces: ["braces", "beams", "roof"],
  roof: ["roof", "beams"],
};

function clusterFromNx(nx) {
  if (nx < 0.2) return "0";
  if (nx < 0.4) return "1";
  if (nx < 0.6) return "2";
  if (nx < 0.8) return "3";
  return "4";
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function buildPointAdder() {
  let counter = 0;
  const points = [];
  return {
    points,
    add(nx, ny, layer, semanticGroup, weight = DEFAULT_WEIGHT) {
      points.push({
        id: `anchor-${counter}`,
        nx,
        ny,
        cluster: clusterFromNx(nx),
        weight,
        layer,
        semanticGroup,
      });
      counter += 1;
    },
  };
}

function addLine(addPoint, config) {
  const { fromX, fromY, toX, toY, count, layer, semanticGroup, weight = DEFAULT_WEIGHT } = config;
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0 : i / (count - 1);
    addPoint(lerp(fromX, toX, t), lerp(fromY, toY, t), layer, semanticGroup, weight);
  }
}

function addCurve(addPoint, config) {
  const {
    fromX,
    toX,
    count,
    layer,
    semanticGroup,
    weight = DEFAULT_WEIGHT,
    fn,
  } = config;
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0 : i / (count - 1);
    addPoint(lerp(fromX, toX, t), fn(t), layer, semanticGroup, weight);
  }
}

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function groupTokenScore(sourceGroup, targetGroup) {
  const sourceTokens = sourceGroup.split(/[:_]/g);
  const targetTokens = targetGroup.split(/[:_]/g);
  let score = 0;
  for (const token of sourceTokens) {
    if (token.length <= 2) continue;
    if (targetTokens.includes(token)) score += 1;
  }
  return score;
}

export function buildBridgeTemplateDetailed() {
  const { points, add } = buildPointAdder();

  addLine(add, {
    fromX: 0.07,
    fromY: 0.86,
    toX: 0.43,
    toY: 0.86,
    count: 14,
    layer: "foundation",
    semanticGroup: "foundation:left_strip",
    weight: 1.1,
  });
  addLine(add, {
    fromX: 0.57,
    fromY: 0.86,
    toX: 0.93,
    toY: 0.86,
    count: 14,
    layer: "foundation",
    semanticGroup: "foundation:right_strip",
    weight: 1.1,
  });
  addLine(add, {
    fromX: 0.08,
    fromY: 0.8,
    toX: 0.92,
    toY: 0.8,
    count: 18,
    layer: "foundation",
    semanticGroup: "foundation:cap",
    weight: 1.02,
  });

  const pierXs = [0.18, 0.34, 0.5, 0.66, 0.82];
  pierXs.forEach((x, index) => {
    addLine(add, {
      fromX: x,
      fromY: 0.79,
      toX: x,
      toY: 0.52,
      count: 6,
      layer: "supports",
      semanticGroup: `supports:pier_${index}`,
      weight: 1.08,
    });
  });

  addLine(add, {
    fromX: 0.1,
    fromY: 0.49,
    toX: 0.9,
    toY: 0.49,
    count: 20,
    layer: "beams",
    semanticGroup: "beams:deck_lower",
    weight: 1,
  });
  addLine(add, {
    fromX: 0.1,
    fromY: 0.45,
    toX: 0.9,
    toY: 0.45,
    count: 20,
    layer: "beams",
    semanticGroup: "beams:deck_upper",
    weight: 1.02,
  });

  addCurve(add, {
    fromX: 0.1,
    toX: 0.9,
    count: 22,
    layer: "truss",
    semanticGroup: "truss:upper_chord",
    weight: 0.98,
    fn: (t) => 0.25 + Math.pow(Math.abs(t - 0.5), 2) * 0.29,
  });
  addLine(add, {
    fromX: 0.12,
    fromY: 0.4,
    toX: 0.88,
    toY: 0.4,
    count: 18,
    layer: "truss",
    semanticGroup: "truss:lower_chord",
    weight: 0.92,
  });

  for (let bay = 0; bay < pierXs.length - 1; bay += 1) {
    const xLeft = pierXs[bay];
    const xRight = pierXs[bay + 1];
    addLine(add, {
      fromX: xLeft,
      fromY: 0.45,
      toX: xRight,
      toY: 0.31,
      count: 5,
      layer: "braces",
      semanticGroup: `braces:bay_${bay}_a`,
      weight: 0.84,
    });
    addLine(add, {
      fromX: xLeft,
      fromY: 0.31,
      toX: xRight,
      toY: 0.45,
      count: 5,
      layer: "braces",
      semanticGroup: `braces:bay_${bay}_b`,
      weight: 0.84,
    });
  }

  const template = {
    id: "bridge",
    points,
    lineHints: [],
  };
  template.lineHints = buildLineHints(template);
  return template;
}

export function buildIndustrialTemplateDetailed() {
  const { points, add } = buildPointAdder();

  addLine(add, {
    fromX: 0.08,
    fromY: 0.85,
    toX: 0.92,
    toY: 0.85,
    count: 18,
    layer: "foundation",
    semanticGroup: "foundation:strip",
    weight: 1.08,
  });
  const columns = [0.12, 0.24, 0.36, 0.5, 0.64, 0.76, 0.88];
  columns.forEach((x, index) => {
    addLine(add, {
      fromX: x - 0.02,
      fromY: 0.82,
      toX: x + 0.02,
      toY: 0.82,
      count: 3,
      layer: "foundation",
      semanticGroup: `foundation:footing_${index}`,
      weight: 1.04,
    });
  });

  columns.forEach((x, index) => {
    addLine(add, {
      fromX: x,
      fromY: 0.82,
      toX: x,
      toY: 0.28,
      count: 8,
      layer: "supports",
      semanticGroup: `supports:column_${index}`,
      weight: 1.02,
    });
  });

  const beamRows = [0.68, 0.56, 0.44, 0.32];
  beamRows.forEach((y, index) => {
    addLine(add, {
      fromX: 0.12,
      fromY: y,
      toX: 0.88,
      toY: y,
      count: 16,
      layer: "beams",
      semanticGroup: `beams:level_${index}`,
      weight: 0.96,
    });
  });

  for (let i = 0; i < columns.length - 1; i += 1) {
    const xLeft = columns[i];
    const xRight = columns[i + 1];
    addLine(add, {
      fromX: xLeft,
      fromY: 0.68,
      toX: xRight,
      toY: 0.56,
      count: 4,
      layer: "braces",
      semanticGroup: `braces:upper_${i}_a`,
      weight: 0.82,
    });
    addLine(add, {
      fromX: xLeft,
      fromY: 0.56,
      toX: xRight,
      toY: 0.68,
      count: 4,
      layer: "braces",
      semanticGroup: `braces:upper_${i}_b`,
      weight: 0.82,
    });
    addLine(add, {
      fromX: xLeft,
      fromY: 0.44,
      toX: xRight,
      toY: 0.32,
      count: 4,
      layer: "braces",
      semanticGroup: `braces:lower_${i}_a`,
      weight: 0.8,
    });
    addLine(add, {
      fromX: xLeft,
      fromY: 0.32,
      toX: xRight,
      toY: 0.44,
      count: 4,
      layer: "braces",
      semanticGroup: `braces:lower_${i}_b`,
      weight: 0.8,
    });
  }

  addLine(add, {
    fromX: 0.12,
    fromY: 0.24,
    toX: 0.88,
    toY: 0.24,
    count: 16,
    layer: "roof",
    semanticGroup: "roof:tie",
    weight: 0.93,
  });
  addLine(add, {
    fromX: 0.12,
    fromY: 0.24,
    toX: 0.5,
    toY: 0.14,
    count: 10,
    layer: "roof",
    semanticGroup: "roof:slope_left",
    weight: 0.9,
  });
  addLine(add, {
    fromX: 0.5,
    fromY: 0.14,
    toX: 0.88,
    toY: 0.24,
    count: 10,
    layer: "roof",
    semanticGroup: "roof:slope_right",
    weight: 0.9,
  });

  const template = {
    id: "industrial_frame",
    points,
    lineHints: [],
  };
  template.lineHints = buildLineHints(template);
  return template;
}

export function buildLineHints(template) {
  const hints = [];
  const seen = new Set();
  const byGroup = new Map();

  for (const point of template.points) {
    if (!byGroup.has(point.semanticGroup)) byGroup.set(point.semanticGroup, []);
    byGroup.get(point.semanticGroup).push(point);
  }

  for (const points of byGroup.values()) {
    points.sort((a, b) => (a.nx === b.nx ? a.ny - b.ny : a.nx - b.nx));
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      const key = pairKey(a.id, b.id);
      if (seen.has(key)) continue;
      seen.add(key);
      hints.push({
        from: a.id,
        to: b.id,
        strength: LAYER_STRENGTH[a.layer] || 0.75,
      });
    }
  }

  return hints;
}

export function buildSemanticMorphMap(fromTemplate, toTemplate) {
  const byFromId = {};
  const toByLayer = new Map();

  for (const point of toTemplate.points) {
    if (!toByLayer.has(point.layer)) toByLayer.set(point.layer, []);
    toByLayer.get(point.layer).push(point);
  }

  for (const source of fromTemplate.points) {
    const preferredLayers = MORPH_LAYER_RULES[source.layer] || [source.layer];
    let candidatePool = [];
    for (const layer of preferredLayers) {
      candidatePool = candidatePool.concat(toByLayer.get(layer) || []);
    }
    if (!candidatePool.length) candidatePool = toTemplate.points;

    let best = candidatePool[0];
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of candidatePool) {
      const dx = source.nx - candidate.nx;
      const dy = source.ny - candidate.ny;
      const spatial = Math.hypot(dx, dy);
      const clusterPenalty = source.cluster === candidate.cluster ? 0 : 0.12;
      const semanticBonus = groupTokenScore(source.semanticGroup, candidate.semanticGroup) * 0.05;
      const score = spatial + clusterPenalty - semanticBonus;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    byFromId[source.id] = best.id;
  }

  return { byFromId };
}
