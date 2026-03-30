const test = require("node:test");
const assert = require("node:assert/strict");

const {
  hasRequiredPublishTag,
  resolveTaskName,
  buildPrefixedArticleName,
  stripArticleDatePrefix,
  formatIssueTitleFromArticleName,
  normalizeSoftwareProjectMappingsSetting,
  parseSoftwareProjectMappings,
  parseGitLabProjectUrl,
  parseImageWidthSpec,
  parseMarkdownImageWidth,
  parseWikiImageTarget,
  formatUploadedImageMarkdown,
  buildPlmTaskName,
  buildTaskTimeRange,
  buildExecutorFrontmatterValue,
  buildWorkItemId,
  buildWorkItemDateSyncPayload,
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

test("buildPrefixedArticleName adds start date prefix only when article name does not already start with yyyy-mm-dd", () => {
  const startDate = { raw: "2026-03-24", year: "2026", month: "03", day: "24" };

  assert.equal(buildPrefixedArticleName("收益管理任务", startDate), "2026-03-24 收益管理任务");
  assert.equal(buildPrefixedArticleName("2026-03-20 收益管理任务", startDate), "2026-03-20 收益管理任务");
});

test("stripArticleDatePrefix removes a leading yyyy-mm-dd prefix before issue title generation", () => {
  assert.equal(stripArticleDatePrefix("2026-03-24 收益管理任务"), "收益管理任务");
  assert.equal(stripArticleDatePrefix("2026-03-24收益管理任务"), "收益管理任务");
  assert.equal(stripArticleDatePrefix("收益管理任务"), "收益管理任务");
});

test("formatIssueTitleFromArticleName uses normalized article name instead of frontmatter task name", () => {
  const startDate = { raw: "2026-03-24", year: "2026", month: "03", day: "24" };

  assert.equal(
    formatIssueTitleFromArticleName({
      contract: "合同A",
      software: "系统B",
      articleName: "2026-03-24 收益管理任务",
      startDate,
    }),
    "【合同A】【系统B】收益管理任务_20260324",
  );

  assert.equal(
    formatIssueTitleFromArticleName({
      contract: "",
      software: "系统B",
      articleName: "2026-03-24 收益管理任务",
      startDate,
    }),
    "【系统B】收益管理任务_20260324",
  );
});

test("parseSoftwareProjectMappings parses multiple software mappings and keeps the last duplicate", () => {
  const mappings = parseSoftwareProjectMappings([
    { softwareName: " 系统A ", projectUrl: " https://git.sansi.net:6101/group/a " },
    { softwareName: "系统B", projectUrl: "https://git.sansi.net:6101/group/b" },
    { softwareName: "系统A", projectUrl: "https://git.sansi.net:6101/group/a-new" },
  ]);

  assert.deepEqual(mappings, {
    系统A: "https://git.sansi.net:6101/group/a-new",
    系统B: "https://git.sansi.net:6101/group/b",
  });
});

test("normalizeSoftwareProjectMappingsSetting migrates legacy multiline text into editable rows", () => {
  assert.deepEqual(
    normalizeSoftwareProjectMappingsSetting([
      " 系统A = https://git.sansi.net:6101/group/a ",
      "",
      "系统B=https://git.sansi.net:6101/group/b",
    ].join("\n")),
    [
      { softwareName: "系统A", projectUrl: "https://git.sansi.net:6101/group/a" },
      { softwareName: "系统B", projectUrl: "https://git.sansi.net:6101/group/b" },
    ],
  );
});

test("parseSoftwareProjectMappings rejects malformed project url values", () => {
  assert.throws(
    () => parseSoftwareProjectMappings([{ softwareName: "系统A", projectUrl: "group/project" }]),
    /完整 GitLab 项目地址/,
  );
});

test("parseGitLabProjectUrl extracts base url and project path from a project url", () => {
  assert.deepEqual(
    parseGitLabProjectUrl("https://git.sansi.net:6101/led-display-platform/CCS/ccs-web-2/cyberhub-docs"),
    {
      baseUrl: "https://git.sansi.net:6101",
      projectPath: "led-display-platform/CCS/ccs-web-2/cyberhub-docs",
      project: "led-display-platform%2FCCS%2Fccs-web-2%2Fcyberhub-docs",
    },
  );
});

test("parseGitLabProjectUrl rejects issue urls", () => {
  assert.throws(
    () => parseGitLabProjectUrl("https://git.sansi.net:6101/group/project/-/issues/123"),
    /项目地址格式不正确/,
  );
});

test("buildTaskTimeRange uses the new formatting", () => {
  const startDate = { raw: "2026-03-20", year: "2026", month: "03", day: "20" };
  const endDate = { raw: "2026-03-25", year: "2026", month: "03", day: "25" };

  assert.equal(buildTaskTimeRange(startDate, endDate), "2026-03-20～2026-03-25");
});

test("parseImageWidthSpec extracts width only from valid widthxheight text", () => {
  assert.equal(parseImageWidthSpec("315x267"), "315");
  assert.equal(parseImageWidthSpec(" 315x267 "), "315");
  assert.equal(parseImageWidthSpec("315"), "");
  assert.equal(parseImageWidthSpec("315xabc"), "");
  assert.equal(parseImageWidthSpec("abcx267"), "");
});

test("parseMarkdownImageWidth reads size from obsidian markdown alt text", () => {
  assert.equal(parseMarkdownImageWidth("|315x267"), "315");
  assert.equal(parseMarkdownImageWidth("说明|315x267"), "315");
  assert.equal(parseMarkdownImageWidth("说明"), "");
});

test("parseWikiImageTarget keeps image path and extracts width from size suffix", () => {
  assert.deepEqual(parseWikiImageTarget("image-1.png|315x267"), {
    linkTarget: "image-1.png",
    width: "315",
  });
  assert.deepEqual(parseWikiImageTarget("image-1.png"), {
    linkTarget: "image-1.png",
    width: "",
  });
});

test("formatUploadedImageMarkdown rewrites uploaded markdown into width-aware gitlab markdown", () => {
  assert.equal(
    formatUploadedImageMarkdown({ markdown: "![image](/uploads/abc/image-1.png)" }, "315"),
    "![](</uploads/abc/image-1.png>){width=315}",
  );
  assert.equal(
    formatUploadedImageMarkdown({ markdown: "![image](/uploads/abc/image-1.png)" }, ""),
    "![image](/uploads/abc/image-1.png)",
  );
  assert.equal(
    formatUploadedImageMarkdown({ url: "/uploads/abc/image-1.png" }, "315"),
    "![](</uploads/abc/image-1.png>){width=315}",
  );
  assert.equal(
    formatUploadedImageMarkdown({ url: "/uploads/abc/image-1.png" }, ""),
    "![](</uploads/abc/image-1.png>)",
  );
});

test("buildExecutorFrontmatterValue rewrites assignees into wiki-link arrays", () => {
  assert.deepEqual(
    buildExecutorFrontmatterValue(["张三", "李四", "张三", " [[王五]] ", ""]),
    ["[[张三]]", "[[李四]]", "[[王五]]"],
  );
  assert.deepEqual(buildExecutorFrontmatterValue([]), []);
});

test("buildWorkItemId converts issue id into GitLab WorkItem gid", () => {
  assert.equal(buildWorkItemId({ id: 55444 }), "gid://gitlab/WorkItem/55444");
  assert.throws(() => buildWorkItemId({ id: "" }), /issue id/);
});

test("buildWorkItemDateSyncPayload includes start and due dates for work item update mutation", () => {
  const payload = buildWorkItemDateSyncPayload(
    { id: 55444 },
    {
      startDate: { raw: "2026-03-24", year: "2026", month: "03", day: "24" },
      endDate: { raw: "2026-03-31", year: "2026", month: "03", day: "31" },
    },
  );

  assert.equal(payload.operationName, "workItemUpdate");
  assert.deepEqual(payload.variables, {
    input: {
      id: "gid://gitlab/WorkItem/55444",
      startAndDueDateWidget: {
        isFixed: true,
        startDate: "2026-03-24",
        dueDate: "2026-03-31",
      },
    },
  });
  assert.match(payload.query, /mutation workItemUpdate/);
  assert.match(payload.query, /errors/);
});

test("buildPlmTaskName uses contract, software, task name, row task type, and start date", () => {
  const startDate = { raw: "2026-03-20", year: "2026", month: "03", day: "20" };

  assert.equal(
    buildPlmTaskName({
      contract: "合同A",
      software: "系统B",
      taskName: "收益测算",
      startDate,
      taskType: "开发",
    }),
    "【合同A】【系统B】收益测算_开发_20260320",
  );

  assert.equal(
    buildPlmTaskName({
      contract: "",
      software: "系统B",
      taskName: "收益测算",
      startDate,
      taskType: "开发",
    }),
    "【系统B】收益测算_开发_20260320",
  );

  assert.equal(
    buildPlmTaskName({
      contract: "合同A",
      software: "",
      taskName: "收益测算",
      startDate,
      taskType: "开发",
    }),
    "【合同A】收益测算_开发_20260320",
  );

  assert.equal(
    buildPlmTaskName({
      contract: "",
      software: "",
      taskName: "收益测算",
      startDate,
      taskType: "开发",
    }),
    "收益测算_开发_20260320",
  );

  assert.equal(
    buildPlmTaskName({
      contract: "",
      software: "排班管理",
      taskName: "2026-03-24 基础框架",
      startDate,
      taskType: "2D设计",
    }),
    "【排班管理】基础框架_2D设计_20260320",
  );
});

test("updateLastTaskScheduleTable keeps PLM task name column and updates plm task names and time range for every row", () => {
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
  assert.match(lastSection, /\| PLM任务名称 \| 执行人 \| 计划工时 \| 任务类型 \| 确认人 \| 时间范围 \|/);
  assert.match(lastSection, /\| 【合同A】【系统B】收益测算_开发_20260320 \| 李四 \| 2h \| 开发 \| 郭程豪 \| 2026-03-20～2026-03-25 \|/);
  assert.match(lastSection, /\| 【合同A】【系统B】收益测算_测试_20260320 \| 王五 \| 3h \| 测试 \| 郭程豪 \| 2026-03-20～2026-03-25 \|/);
});

test("updateLastTaskScheduleTable throws when task schedule table lacks PLM task name column", () => {
  const original = [
    "## 任务安排",
    "",
    "| 执行人 | 计划工时 | 任务类型 | 确认人 | 时间范围 |",
    "| --- | ---- | ---- | --- | ---- |",
    "| 李四 | 2h | 开发 | 郭程豪 |      |",
    "",
  ].join("\n");

  assert.throws(
    () => updateLastTaskScheduleTable(original, {
      taskName: "收益测算",
      contract: "合同A",
      software: "系统B",
      startDate: { raw: "2026-03-20", year: "2026", month: "03", day: "20" },
      endDate: { raw: "2026-03-25", year: "2026", month: "03", day: "25" },
    }),
    /缺少 PLM任务名称 列/,
  );
});

test("updateLastTaskScheduleTable throws when any row lacks task type", () => {
  const original = [
    "## 任务安排",
    "",
    "| PLM任务名称 | 执行人 | 计划工时 | 任务类型 | 确认人 | 时间范围 |",
    "| --- | ---- | ---- | --- | ---- | ---- |",
    "|  | 李四 | 2h |  | 郭程豪 |      |",
    "",
  ].join("\n");

  assert.throws(
    () => updateLastTaskScheduleTable(original, {
      taskName: "收益测算",
      contract: "合同A",
      software: "系统B",
      startDate: { raw: "2026-03-20", year: "2026", month: "03", day: "20" },
      endDate: { raw: "2026-03-25", year: "2026", month: "03", day: "25" },
    }),
    /任务类型/,
  );
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
