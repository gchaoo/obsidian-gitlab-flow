const test = require("node:test");
const assert = require("node:assert/strict");

const {
  hasRequiredPublishTag,
  resolveMeetingTopic,
  resolveMeetingSyncMode,
  extractGitLabIssueTargetUrl,
  parseGitLabIssueTargetUrl,
  resolveTaskName,
  buildPublishedArticleName,
  formatIssueTitleFromArticleName,
  normalizeSoftwareProjectMappingsSetting,
  parseSoftwareProjectMappings,
  parseGitLabProjectUrl,
  parseImageWidthSpec,
  parseMarkdownImageWidth,
  parseObsidianEmbedTarget,
  parseWikiImageTarget,
  extractMarkdownBlockFragment,
  extractMarkdownHeadingFragment,
  rewriteRelativeMarkdownImagePaths,
  formatUploadedImageMarkdown,
  buildPlmTaskName,
  buildTaskTimeRange,
  buildExecutorFrontmatterValue,
  buildWorkItemId,
  buildWorkItemDateSyncPayload,
  extractAssigneeNamesFromLastTaskScheduleTable,
  updateLastTaskScheduleTable,
} = require("./task-publish-utils");

test("hasRequiredPublishTag matches exact required tags in array and string values", () => {
  assert.equal(hasRequiredPublishTag(["普通任务", "PLM任务"], "PLM任务"), true);
  assert.equal(hasRequiredPublishTag("PLM任务", "PLM任务"), true);
  assert.equal(hasRequiredPublishTag(["[[PLM任务]]"], "PLM任务"), true);
  assert.equal(hasRequiredPublishTag(["PLM任务-扩展"], "PLM任务"), false);
  assert.equal(hasRequiredPublishTag(["普通任务"], "PLM任务"), false);
  assert.equal(hasRequiredPublishTag(null, "PLM任务"), false);
  assert.equal(hasRequiredPublishTag(["会议纪要", "普通文档"], "会议纪要"), true);
  assert.equal(hasRequiredPublishTag("会议纪要-补充", "会议纪要"), false);
});

test("resolveTaskName falls back to file basename when task name is empty", () => {
  assert.equal(resolveTaskName("收益测算", "任务登记 issue"), "收益测算");
  assert.equal(resolveTaskName("", "任务登记 issue"), "任务登记 issue");
  assert.equal(resolveTaskName("   ", "任务登记 issue"), "任务登记 issue");
  assert.equal(resolveTaskName("", "01-任务登记 issue"), "任务登记 issue");
  assert.equal(resolveTaskName("", "9-任务登记 issue_20260401"), "任务登记 issue_20260401");
});

test("resolveMeetingTopic falls back to file basename when meeting topic is empty", () => {
  assert.equal(resolveMeetingTopic("周会纪要", "会议纪要"), "周会纪要");
  assert.equal(resolveMeetingTopic("", "会议纪要"), "会议纪要");
  assert.equal(resolveMeetingTopic("   ", "会议纪要"), "会议纪要");
});

test("resolveMeetingSyncMode chooses issue body or note update by target link type", () => {
  assert.equal(resolveMeetingSyncMode({ noteId: "123" }), "note");
  assert.equal(resolveMeetingSyncMode({ noteId: "" }), "issue");
  assert.equal(resolveMeetingSyncMode({}), "issue");
});

test("extractGitLabIssueTargetUrl accepts issue and work item urls", () => {
  assert.equal(
    extractGitLabIssueTargetUrl("目标 https://git.sansi.net:6101/group/project/-/issues/2058"),
    "https://git.sansi.net:6101/group/project/-/issues/2058",
  );
  assert.equal(
    extractGitLabIssueTargetUrl("目标 https://git.sansi.net:6101/group/project/-/work_items/2058#note_123"),
    "https://git.sansi.net:6101/group/project/-/work_items/2058#note_123",
  );
  assert.equal(extractGitLabIssueTargetUrl("https://git.sansi.net:6101/group/project/-/merge_requests/1"), "");
});

test("parseGitLabIssueTargetUrl parses work item urls as issue targets", () => {
  assert.deepEqual(
    parseGitLabIssueTargetUrl(
      "https://git.sansi.net:6101/led-display-platform/CCS/ccs-web-2/cyberhub-docs/-/work_items/2058#note_123",
      (projectPath) => projectPath.replace(/^\//, "").replaceAll("/", "%2F"),
    ),
    {
      baseUrl: "https://git.sansi.net:6101",
      projectPath: "led-display-platform/CCS/ccs-web-2/cyberhub-docs",
      project: "led-display-platform%2FCCS%2Fccs-web-2%2Fcyberhub-docs",
      issueIid: "2058",
      noteId: "123",
    },
  );
});

test("parseObsidianEmbedTarget parses markdown heading and block embeds", () => {
  assert.deepEqual(parseObsidianEmbedTarget("需求.md#综合态势"), {
    filePath: "需求.md",
    fragment: "综合态势",
    fragmentType: "heading",
    isFragment: true,
    isMarkdown: true,
  });
  assert.deepEqual(parseObsidianEmbedTarget("需求.md#^abc123"), {
    filePath: "需求.md",
    fragment: "abc123",
    fragmentType: "block",
    isFragment: true,
    isMarkdown: true,
  });
  assert.deepEqual(parseObsidianEmbedTarget("需求#综合态势|别名"), {
    filePath: "需求",
    fragment: "综合态势",
    fragmentType: "heading",
    isFragment: true,
    isMarkdown: true,
  });
  assert.deepEqual(parseObsidianEmbedTarget("image.png"), {
    filePath: "image.png",
    fragment: "",
    fragmentType: "",
    isFragment: false,
    isMarkdown: false,
  });
});

test("extractMarkdownHeadingFragment reads heading content until same or higher heading", () => {
  const markdown = [
    "# 项目",
    "",
    "## 综合态势",
    "加动态效果",
    "### 能耗统计",
    "随季节变化",
    "## 其他",
    "不应包含",
  ].join("\n");

  assert.equal(
    extractMarkdownHeadingFragment(markdown, "综合态势"),
    ["加动态效果", "### 能耗统计", "随季节变化"].join("\n"),
  );
  assert.throws(() => extractMarkdownHeadingFragment(markdown, "不存在"), /未找到标题片段/);
});

test("extractMarkdownBlockFragment reads block content and removes block id", () => {
  const markdown = [
    "第一段",
    "",
    "- 屏幕还在采购中",
    "- 屏的宽高尺寸还未确认 ^abc123",
    "- 包柱屏",
    "",
    "结束",
  ].join("\n");

  assert.equal(
    extractMarkdownBlockFragment(markdown, "abc123"),
    ["- 屏幕还在采购中", "- 屏的宽高尺寸还未确认", "- 包柱屏"].join("\n"),
  );
  assert.throws(() => extractMarkdownBlockFragment(markdown, "missing"), /未找到块引用/);
});

test("rewriteRelativeMarkdownImagePaths resolves fragment images from the source file location", () => {
  const markdown = [
    "![](./assets/a.png)",
    "![|315x267](assets/b.png)",
    "![](https://example.com/remote.png)",
    "![[image.png]]",
  ].join("\n");

  assert.equal(
    rewriteRelativeMarkdownImagePaths(markdown, "projects/demo/source.md", "meetings/2026/week.md"),
    [
      "![](../../projects/demo/assets/a.png)",
      "![|315x267](../../projects/demo/assets/b.png)",
      "![](https://example.com/remote.png)",
      "![[image.png]]",
    ].join("\n"),
  );
});

test("buildPublishedArticleName removes legacy date prefixes and appends a yyyymmdd suffix when missing", () => {
  const startDate = { raw: "2026-03-24", year: "2026", month: "03", day: "24" };

  assert.equal(buildPublishedArticleName("收益管理任务", startDate), "收益管理任务_20260324");
  assert.equal(buildPublishedArticleName("2026-03-20 收益管理任务", startDate), "收益管理任务_20260324");
  assert.equal(buildPublishedArticleName("2026-03-20收益管理任务", startDate), "收益管理任务_20260324");
  assert.equal(buildPublishedArticleName("收益管理任务_20260324", startDate), "收益管理任务_20260324");
  assert.equal(buildPublishedArticleName("收益管理任务_20260320", startDate), "收益管理任务_20260320");
});

test("formatIssueTitleFromArticleName removes leading numeric-hyphen prefixes without duplicating the date suffix", () => {
  const startDate = { raw: "2026-03-24", year: "2026", month: "03", day: "24" };

  assert.equal(
    formatIssueTitleFromArticleName({
      contract: "合同A",
      software: "系统B",
      articleName: "01-收益管理任务_20260324",
      startDate,
    }),
    "【合同A】【系统B】收益管理任务_20260324",
  );

  assert.equal(
    formatIssueTitleFromArticleName({
      contract: "",
      software: "系统B",
      articleName: "9-收益管理任务_20260324",
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

test("buildPlmTaskName uses contract, software, task name, and start date without task type", () => {
  const startDate = { raw: "2026-03-20", year: "2026", month: "03", day: "20" };

  assert.equal(
    buildPlmTaskName({
      contract: "合同A",
      software: "系统B",
      taskName: "收益测算",
      startDate,
    }),
    "【合同A】【系统B】收益测算_20260320",
  );

  assert.equal(
    buildPlmTaskName({
      contract: "",
      software: "系统B",
      taskName: "收益测算",
      startDate,
    }),
    "【系统B】收益测算_20260320",
  );

  assert.equal(
    buildPlmTaskName({
      contract: "合同A",
      software: "",
      taskName: "收益测算",
      startDate,
    }),
    "【合同A】收益测算_20260320",
  );

  assert.equal(
    buildPlmTaskName({
      contract: "",
      software: "",
      taskName: "收益测算",
      startDate,
    }),
    "收益测算_20260320",
  );

  assert.equal(
    buildPlmTaskName({
      contract: "",
      software: "排班管理",
      taskName: "基础框架_20260324",
      startDate,
    }),
    "【排班管理】基础框架_20260320",
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
  assert.match(lastSection, /\| 【合同A】【系统B】收益测算_20260320 \| 李四 \| 2h \| 开发 \| 郭程豪 \| 2026-03-20～2026-03-25 \|/);
  assert.match(lastSection, /\| 【合同A】【系统B】收益测算_20260320 \| 王五 \| 3h \| 测试 \| 郭程豪 \| 2026-03-20～2026-03-25 \|/);
});

test("updateLastTaskScheduleTable prepends PLM task name column when task schedule table lacks it", () => {
  const original = [
    "## 任务安排",
    "",
    "| 执行人 | 计划工时 | 任务类型 | 确认人 | 时间范围 |",
    "| --- | ---- | ---- | --- | ---- |",
    "| 李四 | 2h | 开发 | 郭程豪 |      |",
    "",
  ].join("\n");

  const updated = updateLastTaskScheduleTable(original, {
    taskName: "收益测算",
    contract: "合同A",
    software: "系统B",
    startDate: { raw: "2026-03-20", year: "2026", month: "03", day: "20" },
    endDate: { raw: "2026-03-25", year: "2026", month: "03", day: "25" },
  });

  assert.match(updated, /\| PLM任务名称 \| 执行人 \| 计划工时 \| 任务类型 \| 确认人 \| 时间范围 \|/);
  assert.match(updated, /\| --- \| --- \| --- \| --- \| --- \| --- \|/);
  assert.match(updated, /\| 【合同A】【系统B】收益测算_20260320 \| 李四 \| 2h \| 开发 \| 郭程豪 \| 2026-03-20～2026-03-25 \|/);
});

test("updateLastTaskScheduleTable ignores blank or missing task type values", () => {
  const original = [
    "## 任务安排",
    "",
    "| 执行人 | 计划工时 | 确认人 | 时间范围 |",
    "| --- | ---- | --- | ---- |",
    "| 李四 | 2h | 郭程豪 |      |",
    "",
  ].join("\n");

  const updated = updateLastTaskScheduleTable(original, {
    taskName: "收益测算",
    contract: "合同A",
    software: "系统B",
    startDate: { raw: "2026-03-20", year: "2026", month: "03", day: "20" },
    endDate: { raw: "2026-03-25", year: "2026", month: "03", day: "25" },
  });

  assert.match(updated, /\| PLM任务名称 \| 执行人 \| 计划工时 \| 确认人 \| 时间范围 \|/);
  assert.match(updated, /\| 【合同A】【系统B】收益测算_20260320 \| 李四 \| 2h \| 郭程豪 \| 2026-03-20～2026-03-25 \|/);
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
