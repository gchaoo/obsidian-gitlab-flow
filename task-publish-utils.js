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

function buildTaskTimeRange(startDate, endDate) {
  return `${startDate.raw}～${endDate.raw}`;
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
  const normalizedHeaderCells =
    plmTaskNameIndex >= 0
      ? headerCells.filter((_, index) => index !== plmTaskNameIndex)
      : [...headerCells];
  const timeRangeIndex = normalizedHeaderCells.indexOf("时间范围");
  if (timeRangeIndex < 0) {
    throw new Error("任务安排表格缺少必要列。");
  }

  lines[headerIndex] = formatTableRow(normalizedHeaderCells);
  lines[headerIndex + 1] = formatTableSeparator(normalizedHeaderCells.length);
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const dataRowIndex = headerIndex + 2 + rowIndex;
    const dataCells =
      plmTaskNameIndex >= 0
        ? rows[rowIndex].filter((_, index) => index !== plmTaskNameIndex)
        : [...rows[rowIndex]];
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
  buildTaskTimeRange,
  extractAssigneeNamesFromLastTaskScheduleTable,
  updateLastTaskScheduleTable,
};
