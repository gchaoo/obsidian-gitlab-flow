const path = require("path");

const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const GITLAB_ISSUE_TARGET_URL_RE = /https?:\/\/[^\s)\]]+\/-\/(?:issues|work_items)\/\d+(?:#note_\d+)?/g;

function normalizeTagValue(value) {
  const trimmed = String(value || "").trim();
  const wikiMatch = trimmed.match(/^\[\[([^|\]]+)(?:\|([^\]]+))?\]\]$/);
  return (wikiMatch ? wikiMatch[2] || wikiMatch[1] : trimmed).trim();
}

function hasRequiredPublishTag(value, requiredTag) {
  const expected = normalizeTagValue(requiredTag);
  if (!expected) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((item) => normalizeTagValue(item) === expected);
  }

  return normalizeTagValue(value) === expected;
}

function resolveTaskName(taskName, fallbackFileBaseName) {
  const normalizedTaskName = String(taskName || "").trim();
  if (normalizedTaskName) {
    return normalizedTaskName;
  }
  return removeNumericHyphenPrefix(fallbackFileBaseName);
}

function resolveMeetingTopic(meetingTopic, fallbackFileBaseName) {
  const normalizedMeetingTopic = String(meetingTopic || "").trim();
  if (normalizedMeetingTopic) {
    return normalizedMeetingTopic;
  }
  return String(fallbackFileBaseName || "").trim();
}

function resolveMeetingSyncMode(target) {
  return String(target?.noteId || "").trim() ? "note" : "issue";
}

function extractGitLabIssueTargetUrl(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractGitLabIssueTargetUrl(item);
      if (found) {
        return found;
      }
    }
    return "";
  }
  const text = String(value || "");
  const matched = text.match(GITLAB_ISSUE_TARGET_URL_RE);
  return matched?.[0] || "";
}

function parseGitLabIssueTargetUrl(issueUrl, encodeProjectPathFn = encodeProjectPath) {
  const match = String(issueUrl || "").match(/^(https?:\/\/[^/]+)(\/.+?)\/-\/(?:issues|work_items)\/(\d+)(?:#note_(\d+))?$/);
  if (!match) {
    throw new Error(`GitLab 链接格式不正确：${issueUrl}`);
  }

  const [, baseUrl, projectPath, issueIid, noteId] = match;
  const normalizedProjectPath = projectPath.replace(/^\//, "");
  return {
    baseUrl,
    projectPath: normalizedProjectPath,
    project: encodeProjectPathFn(projectPath),
    issueIid,
    noteId: noteId || "",
  };
}

function parseObsidianEmbedTarget(rawTarget) {
  const targetWithoutAlias = String(rawTarget || "").split("|")[0].trim();
  const hashIndex = targetWithoutAlias.indexOf("#");
  const filePath = (hashIndex >= 0 ? targetWithoutAlias.slice(0, hashIndex) : targetWithoutAlias).trim();
  const rawFragment = hashIndex >= 0 ? targetWithoutAlias.slice(hashIndex + 1).trim() : "";
  const fragmentType = rawFragment.startsWith("^") ? "block" : rawFragment ? "heading" : "";
  const fragment = fragmentType === "block" ? rawFragment.slice(1).trim() : rawFragment;
  const extension = filePath.includes(".") ? filePath.split(".").pop().toLowerCase() : "";

  return {
    filePath,
    fragment,
    fragmentType,
    isFragment: Boolean(fragment),
    isMarkdown: !extension || extension === "md" || extension === "markdown",
  };
}

function extractMarkdownHeadingFragment(markdown, heading) {
  const expectedHeading = String(heading || "").trim();
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  let startIndex = -1;
  let headingLevel = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) {
      continue;
    }
    const title = match[2].trim();
    if (title === expectedHeading) {
      startIndex = index + 1;
      headingLevel = match[1].length;
      break;
    }
  }

  if (startIndex < 0) {
    throw new Error(`未找到标题片段：${expectedHeading}`);
  }

  let endIndex = lines.length;
  for (let index = startIndex; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (match && match[1].length <= headingLevel) {
      endIndex = index;
      break;
    }
  }

  return trimBlankLines(lines.slice(startIndex, endIndex)).join("\n");
}

function extractMarkdownBlockFragment(markdown, blockId) {
  const normalizedBlockId = String(blockId || "").trim();
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const blockPattern = new RegExp(`(?:^|\\s)\\^${escapeRegExp(normalizedBlockId)}\\s*$`);
  const targetIndex = lines.findIndex((line) => blockPattern.test(line));
  if (targetIndex < 0) {
    throw new Error(`未找到块引用：${normalizedBlockId}`);
  }

  let startIndex = targetIndex;
  while (startIndex > 0 && lines[startIndex - 1].trim()) {
    startIndex -= 1;
  }

  let endIndex = targetIndex + 1;
  while (endIndex < lines.length && lines[endIndex].trim()) {
    endIndex += 1;
  }

  const blockLines = lines.slice(startIndex, endIndex);
  blockLines[targetIndex - startIndex] = blockLines[targetIndex - startIndex].replace(blockPattern, "").trimEnd();
  return trimBlankLines(blockLines).join("\n");
}

function rewriteRelativeMarkdownImagePaths(markdown, sourceFilePath, currentFilePath) {
  const sourceDir = path.posix.dirname(String(sourceFilePath || ""));
  const currentDir = path.posix.dirname(String(currentFilePath || ""));

  return String(markdown || "").replace(MARKDOWN_IMAGE_RE, (fullMatch, altText, rawImagePath) => {
    const imagePath = String(rawImagePath || "").trim();
    const cleanedPath = imagePath.replace(/^<|>$/g, "").trim();
    if (!shouldRewriteMarkdownImagePath(cleanedPath)) {
      return fullMatch;
    }

    const sourceImagePath = path.posix.normalize(path.posix.join(sourceDir, cleanedPath));
    const relativePath = path.posix.relative(currentDir, sourceImagePath) || path.posix.basename(sourceImagePath);
    return `![${altText}](${relativePath})`;
  });
}

function shouldRewriteMarkdownImagePath(imagePath) {
  if (!imagePath || imagePath.startsWith("#")) {
    return false;
  }
  if (/^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(imagePath) || /^[a-z][a-z\d+.-]*:/i.test(imagePath)) {
    return false;
  }
  return !path.posix.isAbsolute(imagePath);
}

function trimBlankLines(lines) {
  const output = [...lines];
  while (output.length > 0 && !String(output[0] || "").trim()) {
    output.shift();
  }
  while (output.length > 0 && !String(output[output.length - 1] || "").trim()) {
    output.pop();
  }
  return output;
}

function removeNumericHyphenPrefix(value) {
  return String(value || "").trim().replace(/^\d+-/, "").trim();
}

function removeTrailingDateSuffix(value) {
  return String(value || "").trim().replace(/_\d{8}$/, "").trim();
}

function removeLegacyArticleDatePrefix(articleName) {
  const normalizedArticleName = String(articleName || "").trim();
  if (!normalizedArticleName) {
    return "";
  }
  return normalizedArticleName.replace(/^\d{4}-\d{2}-\d{2}\s*/, "").trim();
}

function hasArticleDateSuffix(articleName) {
  return /_\d{8}$/.test(String(articleName || "").trim());
}

function buildPublishedArticleName(articleName, startDate) {
  const normalizedArticleName = removeLegacyArticleDatePrefix(articleName);
  if (!normalizedArticleName) {
    return "";
  }
  if (hasArticleDateSuffix(normalizedArticleName)) {
    return normalizedArticleName;
  }
  return `${normalizedArticleName}_${startDate.year}${startDate.month}${startDate.day}`;
}

function formatIssueTitleFromArticleName(metadata) {
  const segments = [];
  const contract = metadata.contract ? `【${metadata.contract}】` : "";
  const software = metadata.software ? `【${metadata.software}】` : "";
  const normalizedArticleName = removeNumericHyphenPrefix(metadata.articleName);

  if (contract) {
    segments.push(contract);
  }
  if (software) {
    segments.push(software);
  }
  segments.push(normalizedArticleName);
  return segments.join("");
}

function encodeProjectPath(projectPath) {
  return String(projectPath)
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("%2F");
}

function parseGitLabProjectUrl(projectUrl) {
  const text = String(projectUrl || "").trim();
  let url;
  try {
    url = new URL(text);
  } catch (_) {
    throw new Error(`软件项目地址需填写完整 GitLab 项目地址：${text}`);
  }

  const projectPath = url.pathname.replace(/^\/+|\/+$/g, "");
  if (!/^https?:$/.test(url.protocol) || !projectPath || projectPath.includes("/-/") || projectPath.split("/").length < 2) {
    throw new Error(`GitLab 项目地址格式不正确：${text}`);
  }

  return {
    baseUrl: url.origin,
    projectPath,
    project: encodeProjectPath(projectPath),
  };
}

function normalizeSoftwareProjectMappingsSetting(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => ({
        softwareName: String(item?.softwareName || "").trim(),
        projectUrl: String(item?.projectUrl || "").trim(),
      }))
      .filter((item) => item.softwareName || item.projectUrl);
  }

  return String(value || "")
    .split(/\r?\n/)
    .map((rawLine) => String(rawLine || "").trim())
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) {
        throw new Error(`软件项目映射格式不正确：${line}`);
      }

      return {
        softwareName: line.slice(0, separatorIndex).trim(),
        projectUrl: line.slice(separatorIndex + 1).trim(),
      };
    })
    .filter((item) => item.softwareName || item.projectUrl);
}

function parseSoftwareProjectMappings(value) {
  const mappings = {};
  const items = normalizeSoftwareProjectMappingsSetting(value);

  for (const item of items) {
    const softwareName = String(item?.softwareName || "").trim();
    const projectUrl = String(item?.projectUrl || "").trim();
    if (!softwareName || !projectUrl) {
      throw new Error(`软件项目映射格式不正确：${softwareName || projectUrl || JSON.stringify(item)}`);
    }

    const normalizedTarget = parseGitLabProjectUrl(projectUrl);
    mappings[softwareName] = `${normalizedTarget.baseUrl}/${normalizedTarget.projectPath}`;
  }

  return mappings;
}

function buildTaskTimeRange(startDate, endDate) {
  return `${startDate.raw}～${endDate.raw}`;
}

function parseImageWidthSpec(value) {
  const matched = String(value || "").trim().match(/^(\d+)x(\d+)$/);
  return matched ? matched[1] : "";
}

function parseMarkdownImageWidth(altText) {
  const parts = String(altText || "").split("|");
  return parseImageWidthSpec(parts[parts.length - 1]);
}

function parseWikiImageTarget(rawTarget) {
  const segments = String(rawTarget || "").split("|");
  return {
    linkTarget: String(segments[0] || "").trim(),
    width: parseImageWidthSpec(segments[segments.length - 1]),
  };
}

function extractUploadedImageUrl(uploadData) {
  const markdown = String(uploadData?.markdown || "").trim();
  const markdownMatch = markdown.match(/!\[[^\]]*]\(([^)]+)\)/);
  if (markdownMatch) {
    return String(markdownMatch[1] || "").trim();
  }
  return String(uploadData?.url || "").trim();
}

function formatUploadedImageMarkdown(uploadData, width) {
  const normalizedWidth = String(width || "").trim();
  const url = extractUploadedImageUrl(uploadData);
  if (!normalizedWidth) {
    const markdown = String(uploadData?.markdown || "").trim();
    return markdown || (url ? `![](<${url}>)` : "");
  }

  if (!url) {
    throw new Error("图片上传返回异常：缺少可用图片地址。");
  }
  return `![](<${url}>){width=${normalizedWidth}}`;
}

function buildExecutorFrontmatterValue(assigneeNames) {
  const values = [];
  for (const assigneeName of Array.isArray(assigneeNames) ? assigneeNames : []) {
    const normalizedName = normalizeTagValue(assigneeName);
    if (!normalizedName) {
      continue;
    }
    const wikiLink = `[[${normalizedName}]]`;
    if (!values.includes(wikiLink)) {
      values.push(wikiLink);
    }
  }
  return values;
}

function buildWorkItemId(issue) {
  const issueId = Number(issue?.id);
  if (!Number.isInteger(issueId) || issueId <= 0) {
    throw new Error("GitLab 未返回有效的 issue id，无法同步开始日期和结束日期。");
  }
  return `gid://gitlab/WorkItem/${issueId}`;
}

function buildWorkItemDateSyncPayload(issue, metadata) {
  return {
    operationName: "workItemUpdate",
    variables: {
      input: {
        id: buildWorkItemId(issue),
        startAndDueDateWidget: {
          isFixed: true,
          startDate: metadata.startDate.raw,
          dueDate: metadata.endDate.raw,
        },
      },
    },
    query: [
      "mutation workItemUpdate($input: WorkItemUpdateInput!) {",
      "  workItemUpdate(input: $input) {",
      "    workItem {",
      "      id",
      "    }",
      "    errors",
      "  }",
      "}",
    ].join("\n"),
  };
}

function buildPlmTaskName(metadata) {
  const segments = [];
  const contract = metadata.contract ? `【${metadata.contract}】` : "";
  const software = metadata.software ? `【${metadata.software}】` : "";
  const normalizedTaskName = removeTrailingDateSuffix(metadata.taskName);

  if (contract) {
    segments.push(contract);
  }
  if (software) {
    segments.push(software);
  }
  segments.push(`${normalizedTaskName}_${metadata.startDate.year}${metadata.startDate.month}${metadata.startDate.day}`);
  return segments.join("");
}

function extractAssigneeNamesFromLastTaskScheduleTable(body) {
  const { headerCells, rows } = getLastTaskScheduleTable(body);
  const executorIndex = headerCells.indexOf("执行人");
  if (executorIndex < 0) {
    return [];
  }

  const assignees = [];
  for (const row of rows) {
    const executor = normalizeTagValue(row[executorIndex]);
    if (executor && !assignees.includes(executor)) {
      assignees.push(executor);
    }
  }
  return assignees;
}

function updateLastTaskScheduleTable(body, metadata) {
  const newline = body.includes("\r\n") ? "\r\n" : "\n";
  const lines = body.split(/\r?\n/);
  const { headerIndex, headerCells, rows } = getLastTaskScheduleTable(body);
  if (rows.length === 0) {
    throw new Error("任务安排表格缺少数据行。");
  }

  const normalizedTable = ensurePlmTaskNameColumn(headerCells, rows);
  const normalizedHeaderCells = normalizedTable.headerCells;
  const normalizedRows = normalizedTable.rows;
  const plmTaskNameIndex = normalizedTable.plmTaskNameIndex;

  const timeRangeIndex = normalizedHeaderCells.indexOf("时间范围");
  if (timeRangeIndex < 0) {
    throw new Error("任务安排表格缺少必要列。");
  }

  lines[headerIndex] = formatTableRow(normalizedHeaderCells);
  lines[headerIndex + 1] = formatTableSeparator(normalizedHeaderCells.length);
  for (let rowIndex = 0; rowIndex < normalizedRows.length; rowIndex += 1) {
    const dataRowIndex = headerIndex + 2 + rowIndex;
    const dataCells = [...normalizedRows[rowIndex]];
    dataCells[plmTaskNameIndex] = buildPlmTaskName({
      taskName: metadata.taskName,
      contract: metadata.contract,
      software: metadata.software,
      startDate: metadata.startDate,
    });
    dataCells[timeRangeIndex] = buildTaskTimeRange(metadata.startDate, metadata.endDate);
    lines[dataRowIndex] = formatTableRow(dataCells);
  }

  return lines.join(newline);
}

function ensurePlmTaskNameColumn(headerCells, rows) {
  const plmTaskNameIndex = headerCells.indexOf("PLM任务名称");
  if (plmTaskNameIndex >= 0) {
    return {
      headerCells: [...headerCells],
      rows: rows.map((row) => [...row]),
      plmTaskNameIndex,
    };
  }

  return {
    headerCells: ["PLM任务名称", ...headerCells],
    rows: rows.map((row) => ["", ...row]),
    plmTaskNameIndex: 0,
  };
}

function getLastTaskScheduleTable(body) {
  const lines = body.split(/\r?\n/);
  let headerIndex = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const headerCells = parseTableRow(lines[index]);
    if (headerCells.includes("执行人") && headerCells.includes("时间范围")) {
      headerIndex = index;
    }
  }

  if (headerIndex < 0) {
    throw new Error("未找到任务安排表格。");
  }

  if (!isTableSeparator(lines[headerIndex + 1])) {
    throw new Error("任务安排表格格式不正确。");
  }

  const headerCells = parseTableRow(lines[headerIndex]);
  const rows = [];
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const rowCells = parseTableRow(lines[index]);
    if (rowCells.length === 0) {
      break;
    }
    if (rowCells.length !== headerCells.length) {
      throw new Error("任务安排表格数据列数不正确。");
    }
    rows.push(rowCells);
  }

  return { headerIndex, headerCells, rows };
}

function parseTableRow(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
    return [];
  }

  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function formatTableRow(cells) {
  return `| ${cells.join(" | ")} |`;
}

function formatTableSeparator(columnCount) {
  return `| ${new Array(columnCount).fill("---").join(" | ")} |`;
}

function isTableSeparator(line) {
  if (!line) {
    return false;
  }
  return /^\|\s*[-: ]+(?:\|\s*[-: ]+)+\|\s*$/.test(line.trim());
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  hasRequiredPublishTag,
  resolveMeetingTopic,
  resolveMeetingSyncMode,
  extractGitLabIssueTargetUrl,
  parseGitLabIssueTargetUrl,
  parseObsidianEmbedTarget,
  extractMarkdownBlockFragment,
  extractMarkdownHeadingFragment,
  rewriteRelativeMarkdownImagePaths,
  resolveTaskName,
  buildPublishedArticleName,
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
};
