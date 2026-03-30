const NEW_START_MARKER = "<!-- obsidian-gitlab-flow:online-record:start -->";
const NEW_END_MARKER = "<!-- obsidian-gitlab-flow:online-record:end -->";
const SUPPORTED_HOST = "www.qianwen.com";
const ONLINE_RECORD_SECTION_HEADING = "千问记录";
const ONLINE_RECORD_URL_RE = /https?:\/\/[^\s)\]]+/g;

function getOnlineRecordUrl(markdown) {
  const section = extractHeadingSection(markdown, ONLINE_RECORD_SECTION_HEADING, 2);
  if (!section) {
    return "";
  }

  const candidates = section.match(ONLINE_RECORD_URL_RE) || [];
  return candidates.find((url) => isSupportedOnlineRecordUrl(url)) || "";
}

function isSupportedOnlineRecordUrl(url) {
  if (typeof url !== "string" || !url.trim()) {
    return false;
  }

  try {
    const parsed = new URL(url.trim());
    return (
      parsed.hostname === SUPPORTED_HOST &&
      (parsed.pathname.startsWith("/efficiency/U/") ||
        parsed.pathname.startsWith("/efficiency/doc/transcripts/"))
    );
  } catch (_) {
    return false;
  }
}

function buildOnlineRecordSection(summary) {
  if (!summary?.summary?.trim()) {
    throw new Error("缺少全文概要，无法生成整理内容。");
  }

  const lines = ["## 整理线上记录", "", "### 全文概要", summary.summary.trim()];
  const chapters = Array.isArray(summary.chapters) ? summary.chapters.filter(Boolean) : [];
  if (chapters.length > 0) {
    lines.push("", "### 章节速览");
    for (const chapter of chapters) {
      const time = normalizeInlineText(chapter.time);
      const title = normalizeInlineText(chapter.title);
      const chapterSummary = normalizeInlineText(chapter.summary);
      const prefix = time ? `\`${time}\` ` : "";
      const heading = title || "未命名章节";
      const content = chapterSummary ? `：${chapterSummary}` : "";
      lines.push(`- ${prefix}${heading}${content}`);
    }
  }

  const todos = Array.isArray(summary.todos)
    ? summary.todos.map((item) => normalizeInlineText(item)).filter(Boolean)
    : [];
  if (todos.length > 0) {
    lines.push("", "### 待办事项");
    for (const todo of todos) {
      lines.push(`- ${todo}`);
    }
  }

  return lines.join("\n");
}

function extractTranscriptSummary(result) {
  const bodyText = String(result?.bodyText || "").replace(/\r\n/g, "\n");
  const lines = bodyText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const summary = extractSectionText(lines, "全文概要", ["章节速览", "待办事项", "语音转文字"]);
  if (!summary) {
    throw new Error("未提取到全文概要。");
  }

  return {
    summary,
    chapters: extractChapters(lines),
    todos: extractTodos(lines),
  };
}

function applyOnlineRecordSection(markdown, generatedSection) {
  const source = typeof markdown === "string" ? markdown : "";
  const block = [NEW_START_MARKER, generatedSection.trim(), NEW_END_MARKER].join("\n");
  const normalized = replaceMarkedSection(source, NEW_START_MARKER, NEW_END_MARKER, block);
  if (normalized !== source) {
    return normalized;
  }

  const trimmed = source.replace(/\s*$/, "");
  return trimmed ? `${trimmed}\n\n${block}\n` : `${block}\n`;
}

function replaceMarkedSection(markdown, startMarker, endMarker, replacement) {
  const escapedStart = escapeRegExp(startMarker);
  const escapedEnd = escapeRegExp(endMarker);
  const pattern = new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}\\n?`, "m");
  if (!pattern.test(markdown)) {
    return markdown;
  }

  const replaced = markdown.replace(pattern, `${replacement}\n`);
  return replaced.replace(/\n{3,}/g, "\n\n");
}

function extractHeadingSection(markdown, heading, level) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const normalizedHeading = String(heading || "").trim();
  const expectedPrefix = `${"#".repeat(level)} `;
  let startIndex = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line === `${expectedPrefix}${normalizedHeading}`) {
      startIndex = index + 1;
      break;
    }
  }

  if (startIndex < 0) {
    return "";
  }

  const collected = [];
  for (let index = startIndex; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (headingMatch && headingMatch[1].length <= level) {
      break;
    }
    collected.push(lines[index]);
  }
  return collected.join("\n").trim();
}

function normalizeInlineText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSectionText(lines, heading, stopHeadings) {
  const startIndex = lines.findIndex((line) => line === heading);
  if (startIndex < 0) {
    return "";
  }

  const collected = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (stopHeadings.includes(line)) {
      break;
    }
    collected.push(line);
  }
  return normalizeInlineText(collected.join(" "));
}

function extractChapters(lines) {
  const startIndex = lines.findIndex((line) => line === "章节速览");
  if (startIndex < 0) {
    return [];
  }

  const chapters = [];
  let current = null;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === "待办事项" || line === "语音转文字") {
      break;
    }

    const match = line.match(/^(\d{2}:\d{2}(?::\d{2})?)\s+(.+)$/);
    if (match) {
      if (current) {
        chapters.push(current);
      }
      current = {
        time: match[1],
        title: normalizeInlineText(match[2]),
        summary: "",
      };
      continue;
    }

    if (current) {
      current.summary = normalizeInlineText([current.summary, line].filter(Boolean).join(" "));
    }
  }

  if (current) {
    chapters.push(current);
  }
  return chapters.filter((chapter) => chapter.time && chapter.title);
}

function extractTodos(lines) {
  const startIndex = lines.findIndex((line) => line === "待办事项");
  if (startIndex < 0) {
    return [];
  }

  const todos = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === "语音转文字") {
      break;
    }
    const todo = normalizeInlineText(line.replace(/^[-*•]\s*/, ""));
    if (todo) {
      todos.push(todo);
    }
  }
  return todos;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  NEW_START_MARKER,
  NEW_END_MARKER,
  getOnlineRecordUrl,
  isSupportedOnlineRecordUrl,
  extractTranscriptSummary,
  buildOnlineRecordSection,
  applyOnlineRecordSection,
};
