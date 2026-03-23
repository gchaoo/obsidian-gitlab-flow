# obsidian-gitlab-flow

Obsidian 与 GitLab 的协同流转插件，支持任务发布、线上纪要整理、会议纪要同步。

## 功能

- 在 Obsidian 中将任务文档发布到 GitLab Issue
- 在 Obsidian 中将会议纪要同步到 GitLab 评论
- 在 Obsidian 中根据 `实时记录` 链接整理线上纪要并追加到正文末尾

## 命令

- `同步会议纪要到 GitLab`
- `发布任务到 GitLab`
- `整理线上记录`

## 设置项

- `发布 GitLab 地址`
- `Token 环境变量名`
- `发布目标项目名`
- `评论目标字段名`
- `线上记录字段名`

## 任务发布规则

`发布任务到 GitLab` 仅对满足以下条件的 Markdown 文档生效：

- 当前文件扩展名为 `.md`
- frontmatter 中的 `相关标签` 包含精确值 `PLM任务`

任务发布行为如下：

- `相关链接` 非空时更新已有 Issue，为空时新建 Issue
- `任务名称` 为空时，使用当前文档文件名
- `开始日期`、`结束日期` 必填，且要求 `YYYY-MM-DD` 格式
- Issue 指派人取自最后一个“任务安排”表中的 `执行人` 列，按表格数据行去重后批量同步到 GitLab

发布时会更新文档中最后一个“任务安排”表：

- 移除 `PLM任务名称` 列
- 保留其余列内容
- 将每一行的 `时间范围` 更新为 `开始日期～结束日期`

## 线上记录整理

`整理线上记录` 会读取当前笔记 frontmatter 中配置的线上记录字段，默认字段名为 `实时记录`。

当前仅支持千问实时记录链接：

- `https://www.qianwen.com/efficiency/U/...`
- `https://www.qianwen.com/efficiency/doc/transcripts/...`

执行后会把页面里已有的摘要内容整理成固定区块，追加到正文末尾，并在重复执行时替换上一次生成的区块。

## 安装

将以下文件放到 Obsidian 仓库的插件目录中：

- `manifest.json`
- `main.js`

开发辅助文件：

- `online-record-utils.js`
- `online-record-utils.test.js`
- `settings-layout.test.js`
- `task-publish-utils.js`
- `task-publish-utils.test.js`

插件目录示例：

```text
.obsidian/plugins/obsidian-gitlab-flow/
```

## 开发验证

```bash
node --check main.js
node --test online-record-utils.test.js
node --test settings-layout.test.js
node --test task-publish-utils.test.js
```
