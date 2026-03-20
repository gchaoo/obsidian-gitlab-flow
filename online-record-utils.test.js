const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getOnlineRecordUrl,
  isSupportedOnlineRecordUrl,
  extractTranscriptSummary,
  buildOnlineRecordSection,
  applyOnlineRecordSection,
} = require("./online-record-utils");

test("getOnlineRecordUrl reads configured frontmatter key", () => {
  const cache = {
    frontmatter: {
      实时记录: "https://www.qianwen.com/efficiency/U/example",
    },
  };

  assert.equal(
    getOnlineRecordUrl(cache, "实时记录"),
    "https://www.qianwen.com/efficiency/U/example",
  );
});

test("isSupportedOnlineRecordUrl only accepts qianwen transcript urls", () => {
  assert.equal(isSupportedOnlineRecordUrl("https://www.qianwen.com/efficiency/U/example"), true);
  assert.equal(
    isSupportedOnlineRecordUrl("https://www.qianwen.com/efficiency/doc/transcripts/example?sl=1"),
    true,
  );
  assert.equal(isSupportedOnlineRecordUrl("https://example.com/transcript"), false);
  assert.equal(isSupportedOnlineRecordUrl(""), false);
});

test("buildOnlineRecordSection formats summary, chapters, and todos", () => {
  const markdown = buildOnlineRecordSection({
    summary: "这是概要",
    chapters: [
      { time: "00:00", title: "开场", summary: "会议背景" },
      { time: "02:21", title: "实施计划", summary: "目标与指标" },
    ],
    todos: ["确认房间数量", "核对设备清单"],
  });

  assert.match(markdown, /## 整理线上记录/);
  assert.match(markdown, /### 全文概要/);
  assert.match(markdown, /### 章节速览/);
  assert.match(markdown, /`00:00` 开场：会议背景/);
  assert.match(markdown, /### 待办事项/);
  assert.match(markdown, /- 确认房间数量/);
});

test("extractTranscriptSummary parses summary, chapters, and todos from page text", () => {
  const parsed = extractTranscriptSummary({
    bodyText: [
      "全文概要",
      "会议围绕立项目标、资源和风险展开。",
      "章节速览",
      "00:00 开场",
      "介绍会议背景与参与方。",
      "02:21 实施计划",
      "确认阶段目标与时间节点。",
      "待办事项",
      "确认房间数量",
      "核对设备清单",
    ].join("\n"),
  });

  assert.equal(parsed.summary, "会议围绕立项目标、资源和风险展开。");
  assert.deepEqual(parsed.chapters, [
    { time: "00:00", title: "开场", summary: "介绍会议背景与参与方。" },
    { time: "02:21", title: "实施计划", summary: "确认阶段目标与时间节点。" },
  ]);
  assert.deepEqual(parsed.todos, ["确认房间数量", "核对设备清单"]);
});

test("applyOnlineRecordSection appends section when no markers exist", () => {
  const original = "## 会议内容\n原始正文";
  const updated = applyOnlineRecordSection(original, "## 整理线上记录\n生成内容");

  assert.match(updated, /原始正文\n\n<!-- obsidian-gitlab-flow:online-record:start -->/);
  assert.match(updated, /生成内容\n<!-- obsidian-gitlab-flow:online-record:end -->/);
});

test("applyOnlineRecordSection ignores legacy markers and appends a new block", () => {
  const original = [
    "## 会议内容",
    "原始正文",
    "",
    "<!-- gitlab-upload-doc:online-record:start -->",
    "旧内容",
    "<!-- gitlab-upload-doc:online-record:end -->",
    "",
  ].join("\n");

  const updated = applyOnlineRecordSection(original, "## 整理线上记录\n新内容");

  assert.match(updated, /旧内容/);
  assert.match(updated, /<!-- obsidian-gitlab-flow:online-record:start -->/);
  assert.match(updated, /新内容/);
});
