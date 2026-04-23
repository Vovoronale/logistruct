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

test("i18n settings config has required schema and locale policy", () => {
  const raw = read("assets/config/i18n-settings.json");
  const parsed = JSON.parse(raw);
  assert.equal(parsed.version, 1, "i18n settings version must be 1");
  assert.deepEqual(
    parsed.supportedLocales,
    ["en", "uk", "pl", "nl", "ja"],
    "supported locales must match required MVP set"
  );
  assert.equal(parsed.defaultLocale, "en", "default locale must be en");
  assert.equal(parsed.storageKey, "logistruct:locale:v1", "storage key contract must be stable");
  assert.doesNotThrow(() => new URL(parsed.siteUrl), "siteUrl must be an absolute URL");
});

test("i18n dictionary has full locale coverage with non-empty strings", () => {
  const raw = read("assets/i18n/dictionary.json");
  const parsed = JSON.parse(raw);
  const requiredLocales = ["en", "uk", "pl", "nl", "ja"];
  assert.equal(parsed.version, 1, "dictionary version must be 1");
  assert.deepEqual(parsed.locales, requiredLocales, "dictionary locale set must match supported locales");
  assert.ok(parsed.entries && typeof parsed.entries === "object", "dictionary entries object is required");

  for (const [key, entry] of Object.entries(parsed.entries)) {
    assert.ok(entry && typeof entry === "object", `entry "${key}" must be an object`);
    requiredLocales.forEach((locale) => {
      assert.ok(
        typeof entry[locale] === "string" && entry[locale].trim().length > 0,
        `entry "${key}" locale "${locale}" must be a non-empty string`
      );
    });
  }
});

test("index contains static i18n bindings and language switcher markup", () => {
  const html = read("index.html");
  assert.ok(html.includes('data-i18n="nav.projects"'), "main nav i18n binding is required");
  assert.ok(html.includes('data-i18n-html="hero.heading_html"'), "hero heading html binding is required");
  assert.ok(html.includes('data-i18n-content="site.description"'), "meta description i18n binding is required");
  assert.ok(html.includes('id="lang-switcher"'), "language switcher element is required");
  assert.ok(html.includes('data-i18n-aria-label="lang.select_aria"'), "language switcher aria i18n binding is required");
});

test("runtime script includes core i18n API and URL locale sync hooks", () => {
  const js = read("assets/app.js");
  assert.ok(js.includes("resolveLocale"), "resolveLocale API is required");
  assert.ok(js.includes("function t("), "t() translation helper is required");
  assert.ok(js.includes("applyStaticTranslations"), "applyStaticTranslations API is required");
  assert.ok(js.includes("applySeoLocaleTags"), "applySeoLocaleTags API is required");
  assert.ok(js.includes("initLanguageSwitcher"), "initLanguageSwitcher API is required");
  assert.ok(js.includes("syncLocaleInUrlPreservingParams"), "URL locale sync API is required");
  assert.ok(js.includes("searchParams.set(\"lang\""), "runtime must write lang query param");
  assert.ok(js.includes("window.history.replaceState"), "runtime must support replaceState locale sync");
  assert.ok(js.includes("window.location.assign"), "runtime must support full reload on manual locale change");
});
