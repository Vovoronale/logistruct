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
    html.includes('src="assets/app.js"'),
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
});

test("styles define design system primitives", () => {
  const css = read("assets/styles.css");
  assert.ok(css.includes(":root"), "CSS variables are required");
  assert.ok(css.includes("--bg"), "Background color token is required");
  assert.ok(css.includes("@keyframes"), "Animation keyframes are required");
});
