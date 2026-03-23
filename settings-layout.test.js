const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");

const MAIN_JS_PATH =
  "/Users/gch/Library/Mobile Documents/iCloud~md~obsidian/Documents/myknowledge/.obsidian/plugins/obsidian-gitlab-flow/main.js";

test("settings labels appear in the expected order", () => {
  const source = fs.readFileSync(MAIN_JS_PATH, "utf8");
  const names = Array.from(source.matchAll(/\.setName\("([^"]+)"\)/g)).map((match) => match[1]);

  assert.deepEqual(names.slice(0, 5), [
    "发布 GitLab 地址",
    "Token 环境变量名",
    "发布目标项目名",
    "评论目标字段名",
    "线上记录字段名",
  ]);
});

test("runtime plugin entry does not require local helper modules", () => {
  const source = fs.readFileSync(MAIN_JS_PATH, "utf8");

  assert.equal(source.includes('require("./'), false);
  assert.equal(source.includes("require('./"), false);
});
