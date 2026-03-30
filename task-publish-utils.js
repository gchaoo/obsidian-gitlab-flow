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
  return String(fallbackFileBaseName || "").trim();
}

function hasArticleDatePrefix(articleName) {
  return /^\d{4}-\d{2}-\d{2}\b/.test(String(articleName || "").trim());
}

function buildPrefixedArticleName(articleName, startDate) {
  const normalizedArticleName = String(articleName || "").trim();
  if (!normalizedArticleName) {
    return "";
  }
  if (hasArticleDatePrefix(normalizedArticleName)) {
    return normalizedArticleName;
  }
  return `${startDate.raw} ${normalizedArticleName}`;
}

function stripArticleDatePrefix(articleName) {
  return String(articleName || "")
    .trim()
    .replace(/^\d{4}-\d{2}-\d{2}\s*/, "")
    .trim();
}

function formatIssueTitleFromArticleName(metadata) {
  const segments = [];
  const contract = metadata.contract ? `【${metadata.contract}】` : "";
  const software = metadata.software ? `【${metadata.software}】` : "";

  if (contract) {
    segments.push(contract);
  }
  if (software) {
    segments.push(software);
  }
  segments.push(
    `${stripArticleDatePrefix(metadata.articleName)}_${metadata.startDate.year}${metadata.startDate.month}${metadata.startDate.day}`,
  );
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
  const taskType = String(metadata.taskType || "").trim();
  const normalizedTaskName = stripArticleDatePrefix(metadata.taskName);
  if (!taskType) {
    throw new Error("任务安排表格中的 任务类型 为必填项。");
  }

  if (contract) {
    segments.push(contract);
  }
  if (software) {
    segments.push(software);
  }
  segments.push(
    `${normalizedTaskName}_${taskType}_${metadata.startDate.year}${metadata.startDate.month}${metadata.startDate.day}`,
  );
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

  const plmTaskNameIndex = headerCells.indexOf("PLM任务名称");
  if (plmTaskNameIndex < 0) {
    throw new Error("任务安排表格缺少 PLM任务名称 列。");
  }

  const taskTypeIndex = headerCells.indexOf("任务类型");
  if (taskTypeIndex < 0) {
    throw new Error("任务安排表格缺少必要列。");
  }

  const timeRangeIndex = headerCells.indexOf("时间范围");
  if (timeRangeIndex < 0) {
    throw new Error("任务安排表格缺少必要列。");
  }

  lines[headerIndex] = formatTableRow(headerCells);
  lines[headerIndex + 1] = formatTableSeparator(headerCells.length);
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const dataRowIndex = headerIndex + 2 + rowIndex;
    const dataCells = [...rows[rowIndex]];
    dataCells[plmTaskNameIndex] = buildPlmTaskName({
      taskName: metadata.taskName,
      contract: metadata.contract,
      software: metadata.software,
      startDate: metadata.startDate,
      taskType: dataCells[taskTypeIndex],
    });
    dataCells[timeRangeIndex] = buildTaskTimeRange(metadata.startDate, metadata.endDate);
    lines[dataRowIndex] = formatTableRow(dataCells);
  }

  return lines.join(newline);
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

module.exports = {
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
};
