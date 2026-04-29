const MOTION_MODES = new Set(["auto", "full", "reduced"]);

export function getMotionMode(searchParams = new URLSearchParams()) {
  const raw = String(searchParams.get("motion") || "auto").trim().toLowerCase();
  return MOTION_MODES.has(raw) ? raw : "auto";
}

export function getCapabilityMotionProfile({
  hardwareConcurrency = 4,
  deviceMemory = 4,
} = {}) {
  const cores = Number.isFinite(Number(hardwareConcurrency))
    ? Number(hardwareConcurrency)
    : 4;
  const memory = Number.isFinite(Number(deviceMemory)) ? Number(deviceMemory) : 4;

  if (cores >= 8 && memory >= 8) return "high";
  if (cores >= 6 && memory >= 4) return "medium";
  return "low";
}

function isConstrainedConnection(connection = null) {
  if (!connection) return false;
  const effectiveType = String(connection.effectiveType || "");
  return Boolean(connection.saveData || /(^|-)2g$/i.test(effectiveType));
}

export function resolveMotionSettings({
  searchParams = new URLSearchParams(),
  hardwareConcurrency = 4,
  deviceMemory = 4,
  connection = null,
  prefersReducedMotion = false,
} = {}) {
  const motionMode = getMotionMode(searchParams);
  const capabilityProfile = getCapabilityMotionProfile({
    hardwareConcurrency,
    deviceMemory,
  });
  const reducedMotion = motionMode === "reduced";
  const profile = reducedMotion ? "reduced" : capabilityProfile;
  const constrainedConnection = isConstrainedConnection(connection);
  const introMode = reducedMotion
    ? "reduced"
    : profile === "low" || constrainedConnection
      ? "short"
      : "full";

  return {
    motionMode,
    profile,
    introMode,
    reducedMotion,
    capabilityProfile,
    constrainedConnection,
    prefersReducedMotion: Boolean(prefersReducedMotion),
  };
}
