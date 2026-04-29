import test from "node:test";
import assert from "node:assert/strict";
import {
  getCapabilityMotionProfile,
  resolveMotionSettings,
} from "../assets/motion-profile.js";

test("auto motion uses browser capability even when reduced-motion is reported", () => {
  const settings = resolveMotionSettings({
    searchParams: new URLSearchParams(""),
    hardwareConcurrency: 8,
    deviceMemory: 8,
    prefersReducedMotion: true,
  });

  assert.equal(settings.motionMode, "auto");
  assert.equal(settings.profile, "high");
  assert.equal(settings.introMode, "full");
  assert.equal(settings.reducedMotion, false);
});

test("explicit reduced motion pins the runtime to reduced", () => {
  const settings = resolveMotionSettings({
    searchParams: new URLSearchParams("motion=reduced"),
    hardwareConcurrency: 8,
    deviceMemory: 8,
    prefersReducedMotion: false,
  });

  assert.equal(settings.motionMode, "reduced");
  assert.equal(settings.profile, "reduced");
  assert.equal(settings.introMode, "reduced");
  assert.equal(settings.reducedMotion, true);
});

test("low capability browsers use the low profile and short intro", () => {
  const settings = resolveMotionSettings({
    searchParams: new URLSearchParams(""),
    hardwareConcurrency: 4,
    deviceMemory: 4,
    prefersReducedMotion: false,
  });

  assert.equal(settings.profile, "low");
  assert.equal(settings.introMode, "short");
});

test("constrained connections shorten intro without changing visual quality profile", () => {
  const settings = resolveMotionSettings({
    searchParams: new URLSearchParams(""),
    hardwareConcurrency: 8,
    deviceMemory: 8,
    connection: { saveData: true, effectiveType: "4g" },
    prefersReducedMotion: false,
  });

  assert.equal(settings.profile, "high");
  assert.equal(settings.introMode, "short");
});

test("capability profile thresholds remain stable", () => {
  assert.equal(getCapabilityMotionProfile({ hardwareConcurrency: 8, deviceMemory: 8 }), "high");
  assert.equal(getCapabilityMotionProfile({ hardwareConcurrency: 6, deviceMemory: 4 }), "medium");
  assert.equal(getCapabilityMotionProfile({ hardwareConcurrency: 4, deviceMemory: 4 }), "low");
});
