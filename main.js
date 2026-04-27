const { Plugin, Notice, PluginSettingTab, Setting, normalizePath } = require("obsidian");
const { execFileSync } = require("child_process");
const path = require("path");

const LOG_PREFIX = "obsidian-gitlab-flow";

const DEFAULT_SETTINGS = {
  tokenEnvVarName: "GITLAB_PERSONAL_ACCESS_TOKEN",
  frontmatterKeys: "相关链接",
  softwareProjectMappings: [],
};

const FILE_MENU_SECTION = "00-obsidian-gitlab-flow";
const ISSUE_URL_RE = /https?:\/\/[^\s)\]]+\/-\/issues\/\d+(?:#note_\d+)?/g;
const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const WIKI_IMAGE_RE = /!\[\[([^\]\n]+)\]\]/g;
const IGNORED_MEETING_FRONTMATTER_KEYS = ["实时记录"];
const TASK_LINK_KEYS = ["相关链接", "相关连接"];
const ONLINE_RECORD_READY_TEXTS = ["全文概要", "章节速览", "语音转文字"];
const ONLINE_RECORD_LOAD_TIMEOUT_MS = 60000;
const REQUIRED_MEETING_TAG = "会议纪要";
const REQUIRED_PUBLISH_TAG = "PLM任务";

module.exports = class ObsidianGitlabFlowPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.softwareProjectMappings = normalizeSoftwareProjectMappingsSetting(this.settings.softwareProjectMappings);

    this.addCommand({
      id: "upload-current-file-to-gitlab-note",
      name: "同步会议纪要到 GitLab",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!this.canUploadMeetingFile(file)) {
          return false;
        }
        if (!checking) {
          this.uploadCurrentFile().catch((error) => {
            console.error(LOG_PREFIX, error);
            new Notice(`上传失败：${error.message}`);
          });
        }
        return true;
      },
    });

    this.addCommand({
      id: "publish-current-task-to-gitlab-issue",
      name: "发布任务到 GitLab",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!this.canPublishTaskFile(file)) {
          return false;
        }
        if (!checking) {
          this.publishCurrentTask().catch((error) => {
            console.error(LOG_PREFIX, error);
            new Notice(`发布失败：${error.message}`);
          });
        }
        return true;
      },
    });

    this.addCommand({
      id: "organize-online-record",
      name: "整理线上记录",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") {
          return false;
        }
        if (!checking) {
          this.organizeOnlineRecordCurrentFile().catch((error) => {
            console.error(LOG_PREFIX, error);
            new Notice(`整理失败：${error.message}`);
          });
        }
        return true;
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!file || file.extension !== "md") {
          return;
        }

        menu.addItem((item) => {
          item
            .setSection(FILE_MENU_SECTION)
            .setTitle("同步会议纪要到 GitLab")
            .setIcon("upload")
            .onClick(async () => {
              try {
                await this.uploadFile(file);
              } catch (error) {
                console.error(LOG_PREFIX, error);
                new Notice(`上传失败：${error.message}`);
              }
            });
        });

        menu.addItem((item) => {
          item
            .setSection(FILE_MENU_SECTION)
            .setTitle("发布任务到 GitLab")
            .setIcon("send")
            .onClick(async () => {
              try {
                await this.publishTaskFile(file);
              } catch (error) {
                console.error(LOG_PREFIX, error);
                new Notice(`发布失败：${error.message}`);
              }
            });
        });

        menu.addItem((item) => {
          item
            .setSection(FILE_MENU_SECTION)
            .setTitle("整理线上记录")
            .setIcon("sparkles")
            .onClick(async () => {
              try {
                await this.organizeOnlineRecordFile(file);
              } catch (error) {
                console.error(LOG_PREFIX, error);
                new Notice(`整理失败：${error.message}`);
              }
            });
        });
      }),
    );

    this.addSettingTab(new ObsidianGitlabFlowSettingTab(this.app, this));
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async uploadCurrentFile() {
    const file = this.app.workspace.getActiveFile();
    if (!this.canUploadMeetingFile(file)) {
      throw new Error(`当前文档缺少标签：${REQUIRED_MEETING_TAG}`);
    }

    await this.uploadFile(file);
  }

  async uploadFile(file) {
    if (!file || file.extension !== "md") {
      throw new Error("只支持 Markdown 文档。");
    }
    if (!this.canUploadMeetingFile(file)) {
      throw new Error(`当前文档缺少标签：${REQUIRED_MEETING_TAG}`);
    }

    const token = this.getToken();
    const markdown = await this.app.vault.cachedRead(file);
    const issueUrl = this.findTargetIssueUrl(file);
    if (!issueUrl) {
      throw new Error("填写url");
    }

    const target = this.parseIssueTarget(issueUrl);
    await this.backfillMeetingTopic(file);
    const cleanedMarkdown = this.removeFrontmatterKeysFromMarkdown(
      markdown,
      this.getIgnoredMeetingFrontmatterKeys(),
    );
    new Notice("开始上传图片并同步 GitLab 内容...");
    const renderedBody = await this.replaceLocalImages(file, cleanedMarkdown, target, token);
    const syncMode = resolveMeetingSyncMode(target);
    if (syncMode === "note") {
      await this.updateNote(target, token, renderedBody);
      new Notice("GitLab 评论已更新。");
      return;
    }

    await this.updateIssueDescription(target, token, renderedBody);
    new Notice("GitLab Issue 正文已更新。");
  }

  async publishCurrentTask() {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") {
      throw new Error("请先打开一个 Markdown 文档。");
    }

    await this.publishTaskFile(file);
  }

  async publishTaskFile(file) {
    if (!file || file.extension !== "md") {
      throw new Error("只支持 Markdown 文档。");
    }
    if (!this.canPublishTaskFile(file)) {
      throw new Error(`当前文档缺少标签：${REQUIRED_PUBLISH_TAG}`);
    }

    file = await this.prepareTaskFileForPublish(file);
    const token = this.getToken();
    const rawMarkdown = await this.app.vault.cachedRead(file);
    const metadata = this.getTaskMetadata(file);
    this.ensureTaskCanPublish(metadata);

    const updatedMarkdown = this.applyTaskTableToMarkdown(rawMarkdown, metadata);
    const bodyMarkdown = this.extractMarkdownBody(updatedMarkdown);
    const issueTitle = this.formatIssueTitle(metadata);
    const existingTarget = metadata.relatedLink ? this.parseIssueTarget(metadata.relatedLink) : null;
    const issueTarget = existingTarget || this.resolvePublishTargetFromSoftware(metadata);
    const assigneeNames = extractAssigneeNamesFromLastTaskScheduleTable(bodyMarkdown);
    const assigneeIds = await Promise.all(
      assigneeNames.map((executor) => this.resolveAssigneeId(issueTarget, token, executor)),
    );
    const labels = existingTarget
      ? await this.buildUpdatedLabels(issueTarget, token, metadata)
      : this.buildPublishLabels([], metadata);

    new Notice("开始上传图片并发布任务 Issue...");
    const renderedBody = await this.replaceLocalImages(file, bodyMarkdown, issueTarget, token);
    const issue = existingTarget
      ? await this.updateIssue(existingTarget, token, issueTitle, renderedBody, {
          assigneeIds,
          labels,
        })
      : await this.createIssue(issueTarget, token, issueTitle, renderedBody, {
          assigneeIds,
          labels,
        });
    await this.syncIssueDates(issueTarget, token, issue, metadata);
    const issueUrl = issue?.web_url || this.buildIssueUrl(issueTarget, issue?.iid);

    if (!issueUrl) {
      throw new Error("GitLab 未返回 issue 地址。");
    }

    await this.app.vault.modify(file, updatedMarkdown);
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      if (metadata.shouldBackfillTaskName) {
        frontmatter["任务名称"] = metadata.taskName;
      }
      frontmatter["执行人"] = buildExecutorFrontmatterValue(assigneeNames);
      frontmatter["相关链接"] = issueUrl;
      frontmatter["状态"] = ["已发布"];
    });

    new Notice("GitLab 任务 Issue 已同步。");
  }

  getIgnoredMeetingFrontmatterKeys() {
    return [...new Set(IGNORED_MEETING_FRONTMATTER_KEYS.filter(Boolean))];
  }

  async backfillMeetingTopic(file) {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!frontmatter) {
      return;
    }

    const meetingTopic = this.readOptionalFrontmatter(frontmatter, "会议主题", { stripWiki: false });
    const nextMeetingTopic = resolveMeetingTopic(meetingTopic, file.basename);
    if (!nextMeetingTopic || nextMeetingTopic === meetingTopic) {
      return;
    }

    await this.app.fileManager.processFrontMatter(file, (currentFrontmatter) => {
      if (!String(currentFrontmatter?.["会议主题"] || "").trim()) {
        currentFrontmatter["会议主题"] = nextMeetingTopic;
      }
    });
  }

  canUploadMeetingFile(file) {
    if (!file || file.extension !== "md") {
      return false;
    }

    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    return hasRequiredPublishTag(frontmatter?.["相关标签"], REQUIRED_MEETING_TAG);
  }

  canPublishTaskFile(file) {
    if (!file || file.extension !== "md") {
      return false;
    }

    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    return hasRequiredPublishTag(frontmatter?.["相关标签"], REQUIRED_PUBLISH_TAG);
  }

  async prepareTaskFileForPublish(file) {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!frontmatter) {
      throw new Error("未找到 frontmatter。");
    }

    const startDate = this.readDateParts(frontmatter["开始日期"], "开始日期");
    const nextBaseName = buildPublishedArticleName(file.basename, startDate);
    if (!nextBaseName || nextBaseName === file.basename) {
      return file;
    }

    const parentPath = file.parent?.path || "";
    const nextPath = normalizePath(parentPath ? `${parentPath}/${nextBaseName}.md` : `${nextBaseName}.md`);
    await this.app.vault.rename(file, nextPath);
    const renamedFile = this.app.vault.getAbstractFileByPath(nextPath);
    return renamedFile || file;
  }

  async organizeOnlineRecordCurrentFile() {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") {
      throw new Error("请先打开一个 Markdown 文档。");
    }

    await this.organizeOnlineRecordFile(file);
  }

  async organizeOnlineRecordFile(file) {
    if (!file || file.extension !== "md") {
      throw new Error("只支持 Markdown 文档。");
    }

    const url = await this.findOnlineRecordUrl(file);
    if (!url) {
      throw new Error("正文 ## 千问记录 下未找到可用链接。");
    }
    if (!isSupportedOnlineRecordUrl(url)) {
      throw new Error("暂不支持该线上记录链接。");
    }

    new Notice("开始整理线上记录...");
    const renderedData = await this.loadRenderedTranscript(url);
    const summary = this.extractTranscriptSummary(renderedData);
    const generatedSection = buildOnlineRecordSection(summary);
    const markdown = await this.app.vault.cachedRead(file);
    const updatedMarkdown = applyOnlineRecordSection(markdown, generatedSection);
    await this.app.vault.modify(file, updatedMarkdown);
    new Notice("线上记录已整理");
  }

  getToken() {
    const name = (this.settings.tokenEnvVarName || "").trim();
    if (!name) {
      throw new Error("请在插件设置中填写环境变量名。");
    }

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`环境变量名不合法：${name}`);
    }

    const value =
      this.readProcessEnv(name) ||
      this.readLaunchctlEnv(name) ||
      this.readShellEnv(name);
    if (!value) {
      throw new Error(`环境变量 ${name} 未设置。若已写入 ~/.zshrc，请重启 Obsidian，或执行 launchctl setenv ${name} <token>。`);
    }
    return value;
  }

  readProcessEnv(name) {
    const value = process?.env?.[name];
    return value ? value.trim() : "";
  }

  readLaunchctlEnv(name) {
    if (process.platform !== "darwin") {
      return "";
    }
    try {
      const value = execFileSync("/bin/launchctl", ["getenv", name], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      return value;
    } catch (_) {
      return "";
    }
  }

  readShellEnv(name) {
    try {
      const value = execFileSync("/bin/zsh", ["-ic", `printenv ${name}`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      return value;
    } catch (_) {
      return "";
    }
  }

  findTargetIssueUrl(file) {
    const cache = this.app.metadataCache.getFileCache(file);
    const keys = (this.settings.frontmatterKeys || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    for (const key of keys) {
      const value = cache?.frontmatter?.[key];
      const found = this.extractIssueUrl(value);
      if (found) {
        return found;
      }
    }
    return "";
  }

  async findOnlineRecordUrl(file) {
    const markdown = await this.app.vault.cachedRead(file);
    return getOnlineRecordUrl(markdown);
  }

  async loadRenderedTranscript(url) {
    const BrowserWindow = resolveBrowserWindowConstructor();
    if (typeof BrowserWindow !== "function") {
      throw new Error("当前环境不支持整理线上记录。");
    }

    const window = new BrowserWindow({
      show: false,
      width: 1440,
      height: 960,
      webPreferences: {
        backgroundThrottling: false,
      },
    });
    window.webContents.setAudioMuted(true);

    try {
      await window.loadURL(url);
      await this.waitForTranscriptReady(window.webContents, ONLINE_RECORD_LOAD_TIMEOUT_MS);
      return await window.webContents.executeJavaScript(
        `(() => {
          const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim();
          const bodyText = document.body?.innerText || "";
          return {
            url: window.location.href,
            title: document.title || "",
            bodyText,
            summaryText: normalize(bodyText.match(/全文概要\\s+([\\s\\S]*?)(?:章节速览|待办事项|语音转文字|$)/)?.[1] || ""),
          };
        })()`,
        true,
      );
    } catch (error) {
      throw new Error(`加载线上记录失败：${error.message}`);
    } finally {
      if (!window.isDestroyed()) {
        window.destroy();
      }
    }
  }

  async waitForTranscriptReady(webContents, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (webContents.isDestroyed()) {
        throw new Error("线上记录窗口已关闭。");
      }

      const bodyText = await webContents
        .executeJavaScript("document.body?.innerText || ''", true)
        .catch(() => "");
      if (ONLINE_RECORD_READY_TEXTS.some((text) => bodyText.includes(text))) {
        return;
      }
      await sleep(1000);
    }

    throw new Error("页面加载超时，未找到线上记录摘要内容。");
  }

  extractTranscriptSummary(result) {
    return extractTranscriptSummaryFromPage(result);
  }

  extractIssueUrl(value) {
    if (!value) {
      return "";
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = this.extractIssueUrl(item);
        if (found) {
          return found;
        }
      }
      return "";
    }
    const text = String(value);
    const matched = text.match(ISSUE_URL_RE);
    return matched?.[0] || "";
  }

  parseIssueTarget(issueUrl) {
    const match = issueUrl.match(/^(https?:\/\/[^/]+)(\/.+?)\/-\/issues\/(\d+)(?:#note_(\d+))?$/);
    if (!match) {
      throw new Error(`GitLab 链接格式不正确：${issueUrl}`);
    }

    const [, baseUrl, projectPath, issueIid, noteId] = match;
    return {
      baseUrl,
      projectPath: projectPath.replace(/^\//, ""),
      project: this.encodeProjectPath(projectPath),
      issueIid,
      noteId: noteId || "",
    };
  }

  resolvePublishTargetFromSoftware(metadata) {
    if (!metadata.software) {
      throw new Error("相关链接为空时，缺少 frontmatter 字段：相关软件");
    }

    const mappings = parseSoftwareProjectMappings(this.settings.softwareProjectMappings);
    const projectUrl = mappings[metadata.software];
    if (!projectUrl) {
      throw new Error(`未找到相关软件“${metadata.software}”对应的 GitLab 项目地址，请先在插件设置中配置。`);
    }

    return parseGitLabProjectUrl(projectUrl, this.encodeProjectPath.bind(this));
  }

  encodeProjectPath(projectPath) {
    return encodeProjectPath(projectPath);
  }

  buildIssueUrl(target, issueIid) {
    if (!target?.baseUrl || !target?.projectPath || !issueIid) {
      return "";
    }
    return `${target.baseUrl}/${target.projectPath}/-/issues/${issueIid}`;
  }

  async resolveAssigneeId(target, token, executor) {
    const response = await fetch(
      `${target.baseUrl}/api/v4/users?search=${encodeURIComponent(executor)}`,
      {
        headers: {
          "PRIVATE-TOKEN": token,
        },
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`查询 GitLab 用户失败：${response.status} ${text}`);
    }

    const users = await response.json();
    if (!Array.isArray(users) || users.length === 0) {
      throw new Error(`未找到执行人对应的 GitLab 用户：${executor}`);
    }

    const normalizedExecutor = executor.replace(/\s+/g, "").toLowerCase();
    const exactUser = users.find((user) => {
      const name = String(user?.name || "").replace(/\s+/g, "").toLowerCase();
      const username = String(user?.username || "").replace(/\s+/g, "").toLowerCase();
      return name === normalizedExecutor || username === normalizedExecutor;
    });

    const chosenUser = exactUser || (users.length === 1 ? users[0] : null);
    if (!chosenUser?.id) {
      throw new Error(`执行人匹配到多个 GitLab 用户，请收窄名称：${executor}`);
    }

    return chosenUser.id;
  }

  getTaskMetadata(file) {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!frontmatter) {
      throw new Error("未找到 frontmatter。");
    }

    const startDate = this.readDateParts(frontmatter["开始日期"], "开始日期");
    const endDate = this.readDateParts(frontmatter["结束日期"], "结束日期");
    const taskName = this.readOptionalFrontmatter(frontmatter, "任务名称");
    const articleName = String(file.basename || "").trim();

    return {
      articleName,
      normalizedArticleName: removeNumericHyphenPrefix(articleName),
      taskName: resolveTaskName(taskName, articleName),
      shouldBackfillTaskName: !taskName,
      executor: this.readOptionalFrontmatter(frontmatter, "执行人"),
      planHours: this.readOptionalFrontmatter(frontmatter, "计划工时", { stripWiki: false }),
      taskType: this.readOptionalFrontmatter(frontmatter, "任务类型"),
      status: this.readOptionalFrontmatter(frontmatter, "状态"),
      relatedLink: this.readFirstNonEmptyFrontmatter(frontmatter, TASK_LINK_KEYS, { stripWiki: false }),
      contract: this.readOptionalFrontmatter(frontmatter, "相关合同", { stripWiki: false }),
      software: this.readOptionalFrontmatter(frontmatter, "相关软件"),
      startDate,
      endDate,
    };
  }

  ensureTaskCanPublish(metadata) {
    return metadata;
  }

  readRequiredFrontmatter(frontmatter, key, options) {
    const value = this.readOptionalFrontmatter(frontmatter, key, options);
    if (!value) {
      throw new Error(`缺少 frontmatter 字段：${key}`);
    }
    return value;
  }

  readOptionalFrontmatter(frontmatter, key, options = {}) {
    const rawValue = frontmatter?.[key];
    return this.normalizeFrontmatterValue(rawValue, options);
  }

  readFirstNonEmptyFrontmatter(frontmatter, keys, options = {}) {
    for (const key of keys) {
      const value = this.normalizeFrontmatterValue(frontmatter?.[key], options);
      if (value) {
        return value;
      }
    }
    return "";
  }

  normalizeFrontmatterValue(value, options = {}) {
    const { stripWiki = true } = options;
    let normalized = value;
    if (Array.isArray(normalized)) {
      normalized = normalized[0];
    }

    if (normalized === null || normalized === undefined) {
      return "";
    }

    let text;
    if (normalized instanceof Date) {
      text = normalized.toISOString().slice(0, 10);
    } else {
      text = String(normalized).trim();
    }

    if (!text) {
      return "";
    }

    return stripWiki ? this.stripWikiLink(text) : text;
  }

  stripWikiLink(text) {
    const trimmed = String(text).trim();
    const wikiMatch = trimmed.match(/^\[\[([^|\]]+)(?:\|([^\]]+))?\]\]$/);
    if (!wikiMatch) {
      return trimmed;
    }
    return (wikiMatch[2] || wikiMatch[1] || "").trim();
  }

  readDateParts(value, key) {
    const text = this.normalizeFrontmatterValue(value, { stripWiki: false });
    const match = text.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
    if (!match) {
      throw new Error(`字段 ${key} 格式不正确，应为 YYYY-MM-DD。`);
    }

    const [, year, month, day] = match;
    return {
      raw: `${year}-${month}-${day}`,
      year,
      month,
      day,
    };
  }

  formatIssueTitle(metadata) {
    const segments = [];
    const contract = metadata.contract ? `【${metadata.contract}】` : "";
    const software = metadata.software ? `【${metadata.software}】` : "";

    if (contract) {
      segments.push(contract);
    }
    if (software) {
      segments.push(software);
    }
    segments.push(metadata.normalizedArticleName);
    return segments.join("");
  }

  buildPublishLabels(existingLabels, metadata) {
    const labels = Array.isArray(existingLabels) ? existingLabels.filter(Boolean) : [];
    const preserved = labels.filter(
      (label) => !String(label).startsWith("contract::") && !String(label).startsWith("scope::"),
    );

    if (metadata.contract) {
      preserved.push(`contract::${metadata.contract}`);
    }
    if (metadata.software) {
      preserved.push(`scope::${metadata.software}`);
    }

    return [...new Set(preserved)];
  }

  async buildUpdatedLabels(target, token, metadata) {
    const issue = await this.getIssue(target, token);
    return this.buildPublishLabels(issue?.labels || [], metadata);
  }

  applyTaskTableToMarkdown(markdown, metadata) {
    const { frontmatterBlock, body } = this.splitFrontmatter(markdown);
    const updatedBody = this.updateTaskScheduleTable(body, metadata);
    return `${frontmatterBlock}${updatedBody}`;
  }

  splitFrontmatter(markdown) {
    const match = markdown.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/);
    if (!match) {
      return { frontmatterBlock: "", body: markdown };
    }
    return {
      frontmatterBlock: match[0],
      body: markdown.slice(match[0].length),
    };
  }

  removeFrontmatterKeysFromMarkdown(markdown, keys = []) {
    const ignoredKeys = new Set(
      (Array.isArray(keys) ? keys : [])
        .map((key) => String(key || "").trim())
        .filter(Boolean),
    );
    if (ignoredKeys.size === 0) {
      return markdown;
    }

    const { frontmatterBlock, body } = this.splitFrontmatter(markdown);
    if (!frontmatterBlock) {
      return markdown;
    }

    const newline = frontmatterBlock.includes("\r\n") ? "\r\n" : "\n";
    const lines = frontmatterBlock.split(/\r?\n/);
    if (lines.length < 3) {
      return markdown;
    }

    const output = [];
    let skipCurrentKey = false;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (index === 0 || index === lines.length - 1) {
        output.push(line);
        skipCurrentKey = false;
        continue;
      }

      if (line.trim() === "---") {
        output.push(line);
        skipCurrentKey = false;
        continue;
      }

      if (/^\S[^:]*:\s*(.*)?$/.test(line)) {
        const key = line.slice(0, line.indexOf(":")).trim();
        skipCurrentKey = ignoredKeys.has(key);
        if (!skipCurrentKey) {
          output.push(line);
        }
        continue;
      }

      if (!skipCurrentKey) {
        output.push(line);
      }
    }

    return `${output.join(newline)}${body}`;
  }

  extractMarkdownBody(markdown) {
    return this.splitFrontmatter(markdown).body;
  }

  updateTaskScheduleTable(body, metadata) {
    return updateLastTaskScheduleTable(body, metadata);
  }

  async replaceLocalImages(file, markdown, target, token) {
    let output = markdown;
    const markdownMatches = Array.from(markdown.matchAll(MARKDOWN_IMAGE_RE));
    for (const match of markdownMatches) {
      const fullMatch = match[0];
      const altText = (match[1] || "").trim();
      const imagePath = (match[2] || "").trim();
      if (!imagePath || /^(https?:)?\/\//.test(imagePath)) {
        continue;
      }
      const uploadData = await this.uploadMarkdownImage(file, imagePath, target, token);
      const uploadMarkdown = formatUploadedImageMarkdown(uploadData, parseMarkdownImageWidth(altText));
      output = output.replace(fullMatch, uploadMarkdown);
    }

    const wikiMatches = Array.from(output.matchAll(WIKI_IMAGE_RE));
    for (const match of wikiMatches) {
      const fullMatch = match[0];
      const rawTarget = (match[1] || "").trim();
      const { linkTarget, width } = parseWikiImageTarget(rawTarget);
      const uploadData = await this.uploadWikiImage(file, linkTarget, target, token);
      const uploadMarkdown = formatUploadedImageMarkdown(uploadData, width);
      output = output.replace(fullMatch, uploadMarkdown);
    }

    return output;
  }

  async uploadMarkdownImage(file, imagePath, target, token) {
    const cleanedPath = imagePath.replace(/^<|>$/g, "");
    const vaultPath = normalizePath(path.join(path.posix.dirname(file.path), cleanedPath));
    const binary = await this.app.vault.adapter.readBinary(vaultPath);
    const fileName = path.posix.basename(vaultPath);
    return this.uploadBinary(fileName, binary, target, token);
  }

  async uploadWikiImage(file, linkTarget, target, token) {
    const linkedFile = this.app.metadataCache.getFirstLinkpathDest(linkTarget, file.path);
    if (!linkedFile) {
      throw new Error(`未找到图片文件：${linkTarget}`);
    }
    const binary = await this.app.vault.adapter.readBinary(linkedFile.path);
    return this.uploadBinary(linkedFile.name, binary, target, token);
  }

  async uploadBinary(fileName, binary, target, token) {
    const form = new FormData();
    const blob = new Blob([binary]);
    form.append("file", blob, fileName);

    const response = await fetch(`${target.baseUrl}/api/v4/projects/${target.project}/uploads`, {
      method: "POST",
      headers: {
        "PRIVATE-TOKEN": token,
      },
      body: form,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`图片上传失败：${response.status} ${text}`);
    }

    const data = await response.json();
    if (data.markdown || data.url) {
      return data;
    }
    throw new Error(`图片上传返回异常：${JSON.stringify(data)}`);
  }

  async createNote(target, token, body) {
    const payload = new URLSearchParams();
    payload.set("body", body);

    const response = await fetch(
      `${target.baseUrl}/api/v4/projects/${target.project}/issues/${target.issueIid}/notes`,
      {
        method: "POST",
        headers: {
          "PRIVATE-TOKEN": token,
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: payload.toString(),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`评论更新失败：${response.status} ${text}`);
    }

    return response.json();
  }

  async updateNote(target, token, body) {
    const payload = new URLSearchParams();
    payload.set("body", body);

    const response = await fetch(
      `${target.baseUrl}/api/v4/projects/${target.project}/issues/${target.issueIid}/notes/${target.noteId}`,
      {
        method: "PUT",
        headers: {
          "PRIVATE-TOKEN": token,
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: payload.toString(),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`评论更新失败：${response.status} ${text}`);
    }

    return response.json();
  }

  async createIssue(target, token, title, description, options = {}) {
    const payload = new URLSearchParams();
    payload.set("title", title);
    payload.set("description", description);
    this.appendIssuePayloadOptions(payload, options);

    const response = await fetch(`${target.baseUrl}/api/v4/projects/${target.project}/issues`, {
      method: "POST",
      headers: {
        "PRIVATE-TOKEN": token,
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: payload.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Issue 创建失败：${response.status} ${text}`);
    }

    return response.json();
  }

  async updateIssue(target, token, title, description, options = {}) {
    const payload = new URLSearchParams();
    payload.set("title", title);
    payload.set("description", description);
    this.appendIssuePayloadOptions(payload, options);

    const response = await fetch(
      `${target.baseUrl}/api/v4/projects/${target.project}/issues/${target.issueIid}`,
      {
        method: "PUT",
        headers: {
          "PRIVATE-TOKEN": token,
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: payload.toString(),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Issue 更新失败：${response.status} ${text}`);
    }

    return response.json();
  }

  async updateIssueDescription(target, token, description) {
    const payload = new URLSearchParams();
    payload.set("description", description);

    const response = await fetch(
      `${target.baseUrl}/api/v4/projects/${target.project}/issues/${target.issueIid}`,
      {
        method: "PUT",
        headers: {
          "PRIVATE-TOKEN": token,
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: payload.toString(),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Issue 内容更新失败：${response.status} ${text}`);
    }

    return response.json();
  }

  async syncIssueDates(target, token, issue, metadata) {
    const issueForSync = issue?.id ? issue : (target?.issueIid ? await this.getIssue(target, token) : issue);
    const payload = buildWorkItemDateSyncPayload(issueForSync, metadata);
    const response = await fetch(`${target.baseUrl}/api/graphql`, {
      method: "POST",
      headers: {
        "PRIVATE-TOKEN": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const rawText = await response.text();
    let result;
    try {
      result = rawText ? JSON.parse(rawText) : {};
    } catch (_) {
      throw new Error(`Issue 日期同步失败：${response.status} ${rawText}`);
    }

    if (!response.ok) {
      throw new Error(`Issue 日期同步失败：${response.status} ${rawText}`);
    }

    const graphQLErrors = Array.isArray(result?.errors) ? result.errors : [];
    if (graphQLErrors.length > 0) {
      const message = graphQLErrors
        .map((item) => String(item?.message || "").trim())
        .filter(Boolean)
        .join("；");
      throw new Error(`Issue 日期同步失败：${message || rawText}`);
    }

    const mutationErrors = Array.isArray(result?.data?.workItemUpdate?.errors)
      ? result.data.workItemUpdate.errors.filter(Boolean)
      : [];
    if (mutationErrors.length > 0) {
      throw new Error(`Issue 日期同步失败：${mutationErrors.join("；")}`);
    }

    return result?.data?.workItemUpdate?.workItem || null;
  }

  appendIssuePayloadOptions(payload, options = {}) {
    const assigneeIds = Array.isArray(options.assigneeIds) ? options.assigneeIds.filter(Boolean) : [];
    if (assigneeIds.length > 0) {
      for (const assigneeId of assigneeIds) {
        payload.append("assignee_ids[]", String(assigneeId));
      }
    }

    const labels = Array.isArray(options.labels) ? options.labels.filter(Boolean) : [];
    if (labels.length > 0) {
      payload.set("labels", labels.join(","));
    }
  }

  async getIssue(target, token) {
    const response = await fetch(
      `${target.baseUrl}/api/v4/projects/${target.project}/issues/${target.issueIid}`,
      {
        headers: {
          "PRIVATE-TOKEN": token,
        },
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`读取 Issue 失败：${response.status} ${text}`);
    }

    return response.json();
  }
};

class ObsidianGitlabFlowSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Token 环境变量名")
      .setDesc("默认读取 GITLAB_PERSONAL_ACCESS_TOKEN。会依次尝试 process.env、launchctl getenv、zsh -ic。")
      .addText((text) =>
        text
          .setPlaceholder("GITLAB_PERSONAL_ACCESS_TOKEN")
          .setValue(this.plugin.settings.tokenEnvVarName)
          .onChange(async (value) => {
            this.plugin.settings.tokenEnvVarName = value.trim() || DEFAULT_SETTINGS.tokenEnvVarName;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("软件项目映射")
      .setDesc("按键值对维护软件名称与完整 GitLab 项目 URL，可逐行新增、删除和修改。")
      .addButton((button) =>
        button
          .setButtonText("新增一行")
          .onClick(async () => {
            this.plugin.settings.softwareProjectMappings.push({ softwareName: "", projectUrl: "" });
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    const mappings = this.plugin.settings.softwareProjectMappings;
    if (mappings.length === 0) {
      mappings.push({ softwareName: "", projectUrl: "" });
    }

    mappings.forEach((mapping, index) => {
      const rowEl = containerEl.createDiv({ cls: "setting-item" });
      rowEl.style.alignItems = "center";

      const controlEl = rowEl.createDiv({ cls: "setting-item-control" });
      controlEl.style.display = "flex";
      controlEl.style.alignItems = "center";
      controlEl.style.justifyContent = "flex-start";
      controlEl.style.gap = "12px";
      controlEl.style.width = "100%";

      const nameInput = controlEl.createEl("input", { type: "text" });
      nameInput.addClass("text-input");
      nameInput.placeholder = "软件名称";
      nameInput.value = mapping.softwareName;
      nameInput.style.width = "220px";
      nameInput.addEventListener("change", async () => {
        this.plugin.settings.softwareProjectMappings[index].softwareName = nameInput.value.trim();
        await this.plugin.saveSettings();
      });

      const urlInput = controlEl.createEl("input", { type: "text" });
      urlInput.addClass("text-input");
      urlInput.placeholder = "https://git.sansi.net:6101/group/project";
      urlInput.value = mapping.projectUrl;
      urlInput.style.flex = "1";
      urlInput.addEventListener("change", async () => {
        this.plugin.settings.softwareProjectMappings[index].projectUrl = urlInput.value.trim();
        await this.plugin.saveSettings();
      });

      const deleteButton = controlEl.createEl("button", { text: "删除" });
      deleteButton.addClass("mod-warning");
      deleteButton.addEventListener("click", async () => {
        this.plugin.settings.softwareProjectMappings.splice(index, 1);
        await this.plugin.saveSettings();
        this.display();
      });
    });

    new Setting(containerEl)
      .setName("评论目标字段名")
      .setDesc("多个字段用英文逗号分隔。默认只读取 相关链接。该设置仅用于“同步会议纪要到 GitLab”。")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.frontmatterKeys)
          .setValue(this.plugin.settings.frontmatterKeys)
          .onChange(async (value) => {
            this.plugin.settings.frontmatterKeys = value.trim() || DEFAULT_SETTINGS.frontmatterKeys;
            await this.plugin.saveSettings();
          }),
      );

  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
      parsed.hostname === "www.qianwen.com" &&
      (parsed.pathname.startsWith("/efficiency/U/") ||
        parsed.pathname.startsWith("/efficiency/doc/transcripts/"))
    );
  } catch (_) {
    return false;
  }
}

function extractTranscriptSummaryFromPage(result) {
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

function applyOnlineRecordSection(markdown, generatedSection) {
  const source = typeof markdown === "string" ? markdown : "";
  const startMarker = "<!-- obsidian-gitlab-flow:online-record:start -->";
  const endMarker = "<!-- obsidian-gitlab-flow:online-record:end -->";
  const block = [startMarker, generatedSection.trim(), endMarker].join("\n");
  const normalized = replaceMarkedSection(source, startMarker, endMarker, block);
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

function normalizeInlineText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
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
  const normalizedTaskName = removeTrailingDateSuffix(metadata.taskName);
  if (!taskType) {
    throw new Error("任务安排表格中的 任务类型 为必填项。");
  }

  if (contract) {
    segments.push(contract);
  }
  if (software) {
    segments.push(software);
  }
  segments.push(`${normalizedTaskName}-${taskType}_${metadata.startDate.year}${metadata.startDate.month}${metadata.startDate.day}`);
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

  const taskTypeIndex = normalizedHeaderCells.indexOf("任务类型");
  if (taskTypeIndex < 0) {
    throw new Error("任务安排表格缺少必要列。");
  }

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
      taskType: dataCells[taskTypeIndex],
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

  if (!isTaskTableSeparator(lines[headerIndex + 1])) {
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

function isTaskTableSeparator(line) {
  if (!line) {
    return false;
  }
  return /^\|\s*[-: ]+(?:\|\s*[-: ]+)+\|\s*$/.test(line.trim());
}

function encodeProjectPath(projectPath) {
  return String(projectPath)
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("%2F");
}

function parseGitLabProjectUrl(projectUrl, encodeProjectPathFn) {
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
    project: encodeProjectPathFn(projectPath),
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

    const normalizedTarget = parseGitLabProjectUrl(projectUrl, encodeProjectPath);
    mappings[softwareName] = `${normalizedTarget.baseUrl}/${normalizedTarget.projectPath}`;
  }

  return mappings;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveBrowserWindowConstructor() {
  const candidates = [];
  if (typeof window !== "undefined" && typeof window.require === "function") {
    candidates.push(window.require.bind(window));
  }
  if (typeof require === "function") {
    candidates.push(require);
  }

  for (const load of candidates) {
    try {
      const electron = load("electron");
      if (typeof electron?.BrowserWindow === "function") {
        return electron.BrowserWindow;
      }
    } catch (_) {
      // Ignore and try the next loader.
    }

    try {
      const remote = load("@electron/remote");
      if (typeof remote?.BrowserWindow === "function") {
        return remote.BrowserWindow;
      }
    } catch (_) {
      // Ignore and try the next loader.
    }
  }

  return null;
}
