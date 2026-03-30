const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");

const MAIN_JS_PATH =
  "/Users/gch/Library/Mobile Documents/iCloud~md~obsidian/Documents/myknowledge/.obsidian/plugins/obsidian-gitlab-flow/main.js";

test("settings labels appear in the expected order", () => {
  const source = fs.readFileSync(MAIN_JS_PATH, "utf8");
  const names = Array.from(source.matchAll(/\.setName\("([^"]+)"\)/g)).map((match) => match[1]);

  assert.deepEqual(names.slice(0, 3), [
    "Token 环境变量名",
    "软件项目映射",
    "评论目标字段名",
  ]);
});

test("runtime plugin entry does not require local helper modules", () => {
  const source = fs.readFileSync(MAIN_JS_PATH, "utf8");

  assert.equal(source.includes('require("./'), false);
  assert.equal(source.includes("require('./"), false);
});

test("software mapping rows do not render per-row labels", () => {
  const source = fs.readFileSync(MAIN_JS_PATH, "utf8");

  assert.equal(source.includes(".setName(`映射 ${index + 1}`)"), false);
});

test("runtime defines a top-level project path encoder for software mapping parsing", () => {
  const source = fs.readFileSync(MAIN_JS_PATH, "utf8");

  assert.equal(source.includes("function encodeProjectPath("), true);
});
