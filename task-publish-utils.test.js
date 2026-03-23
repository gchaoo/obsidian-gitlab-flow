const test = require("node:test");
const assert = require("node:assert/strict");

const {
  hasRequiredPublishTag,
  resolveTaskName,
  buildTaskTimeRange,
  extractAssigneeNamesFromLastTaskScheduleTable,
  updateLastTaskScheduleTable,
} = require("./task-publish-utils");

test("hasRequiredPublishTag matches exact PLM tag in array and string values", () => {
  assert.equal(hasRequiredPublishTag(["普通任务", "PLM任务"], "PLM任务"), true);
  assert.equal(hasRequiredPublishTag("PLM任务", "PLM任务"), true);
  assert.equal(hasRequiredPublishTag(["[[PLM任务]]"], "PLM任务"), true);
  assert.equal(hasRequiredPublishTag(["PLM任务-扩展"], "PLM任务"), false);
  assert.equal(hasRequiredPublishTag(["普通任务"], "PLM任务"), false);
  assert.equal(hasRequiredPublishTag(null, "PLM任务"), false);
});

test("resolveTaskName falls back to file basename when task name is empty", () => {
  assert.equal(resolveTaskName("收益测算", "任务登记 issue"), "收益测算");
  assert.equal(resolveTaskName("", "任务登记 issue"), "任务登记 issue");
  assert.equal(resolveTaskName("   ", "任务登记 issue"), "任务登记 issue");
});

test("buildTaskTimeRange uses the new formatting", () => {
  const startDate = { raw: "2026-03-20", year: "2026", month: "03", day: "20" };
  const endDate = { raw: "2026-03-25", year: "2026", month: "03", day: "25" };

  assert.equal(buildTaskTimeRange(startDate, endDate), "2026-03-20～2026-03-25");
});

test("updateLastTaskScheduleTable removes PLM task name column and updates time range for every row in the last matching table", () => {
  const original = [
    "## 任务安排",
    "",
    "| PLM任务名称 | 执行人 | 计划工时 | 任务类型 | 确认人 | 时间范围 |",
    "| ------- | --- | ---- | ---- | --- | ---- |",
    "| 旧任务 | 张三 | 2h | 开发 | 郭程豪 | 2026-03-01～2026-03-02 |",
    "",
    "## 其他说明",
    "",
    "| PLM任务名称 | 执行人 | 计划工时 | 任务类型 | 确认人 | 时间范围 |",
    "| ------- | --- | ---- | ---- | --- | ---- |",
    "|         | 李四 | 2h | 开发 | 郭程豪 |      |",
    "|         | 王五 | 3h | 测试 | 郭程豪 |      |",
    "",
  ].join("\n");

  const updated = updateLastTaskScheduleTable(original, {
    taskName: "收益测算",
    contract: "合同A",
    software: "系统B",
    startDate: { raw: "2026-03-20", year: "2026", month: "03", day: "20" },
    endDate: { raw: "2026-03-25", year: "2026", month: "03", day: "25" },
  });
  const lastSection = updated.split("## 其他说明")[1];

  assert.match(updated, /\| 旧任务 \| 张三 \| 2h \| 开发 \| 郭程豪 \| 2026-03-01～2026-03-02 \|/);
  assert.doesNotMatch(lastSection, /\| PLM任务名称 \| 执行人 \| 计划工时 \| 任务类型 \| 确认人 \| 时间范围 \|/);
  assert.match(lastSection, /\| 执行人 \| 计划工时 \| 任务类型 \| 确认人 \| 时间范围 \|/);
  assert.match(lastSection, /\| 李四 \| 2h \| 开发 \| 郭程豪 \| 2026-03-20～2026-03-25 \|/);
  assert.match(lastSection, /\| 王五 \| 3h \| 测试 \| 郭程豪 \| 2026-03-20～2026-03-25 \|/);
});

test("extractAssigneeNamesFromLastTaskScheduleTable returns unique executor names from the last matching table", () => {
  const markdown = [
    "| PLM任务名称 | 执行人 | 计划工时 | 任务类型 | 确认人 | 时间范围 |",
    "| ------- | --- | ---- | ---- | --- | ---- |",
    "| 旧任务 | 张三 | 2h | 开发 | 郭程豪 | 2026-03-01～2026-03-02 |",
    "",
    "## 任务安排",
    "",
    "| PLM任务名称 | 执行人 | 计划工时 | 任务类型 | 确认人 | 时间范围 |",
    "| ------- | --- | ---- | ---- | --- | ---- |",
    "| 新任务A | 李四 | 2h | 开发 | 郭程豪 | 2026-03-20～2026-03-21 |",
    "| 新任务B | 王五 | 3h | 测试 | 郭程豪 | 2026-03-22～2026-03-23 |",
    "| 新任务C | 李四 | 1h | 联调 | 郭程豪 | 2026-03-24～2026-03-24 |",
    "",
  ].join("\n");

  assert.deepEqual(extractAssigneeNamesFromLastTaskScheduleTable(markdown), ["李四", "王五"]);
});
