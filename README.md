# obsidian-gitlab-flow

Obsidian 与 GitLab 的协同流转插件，支持任务发布、线上纪要整理、会议纪要同步。

## 功能

- 在 Obsidian 中将任务文档发布到 GitLab Issue
- 在 Obsidian 中将会议纪要同步到 GitLab 评论
- 在 Obsidian 中根据正文 `## 千问记录` 下的千问链接整理线上纪要并追加到正文末尾

## 命令

- `同步会议纪要到 GitLab`
- `发布任务到 GitLab`
- `整理线上记录`

## 设置项

- `Token 环境变量名`
- `软件项目映射`
- `评论目标字段名`

## 按钮规则

### `同步会议纪要到 GitLab`

`同步会议纪要到 GitLab` 仅对当前打开的 Markdown 文档生效，行为规则如下：

- 当前文件扩展名必须为 `.md`
- frontmatter 中的 `相关标签` 必须包含精确值 `会议纪要`
- frontmatter 中的 `会议主题` 为空时，会先回写为当前文件名
- 执行时会读取插件设置中的 `Token 环境变量名`，并从环境变量中获取 GitLab token
- 目标 GitLab 链接会按插件设置 `评论目标字段名` 逐个从 frontmatter 中读取，多个字段用英文逗号分隔，默认只读取 `相关链接`
- 若目标链接是 Issue 链接，则更新对应 Issue 正文
- 若目标链接是 Issue 评论链接，格式需包含 `#note_xxx`，则更新对应评论
- 同步前会从 frontmatter 中移除忽略字段，当前默认忽略 `实时记录`
- 文档中的本地图片会先上传到目标 GitLab 项目，再将正文中的图片链接替换为 GitLab 上传地址；远程图片会保持原样
- 同步成功后，只更新目标 GitLab 内容，不会回写当前 Obsidian 文档正文

### `发布任务到 GitLab`

`发布任务到 GitLab` 仅对满足以下条件的 Markdown 文档生效：

- 当前文件扩展名为 `.md`
- frontmatter 中的 `相关标签` 包含精确值 `PLM任务`

任务发布行为如下：

- `相关链接` 非空时更新已有 Issue
- `相关链接` 为空时，必须根据 frontmatter `相关软件` 命中“软件项目映射”中的完整 GitLab 项目地址后新建 Issue
- 若 `相关软件` 为空、未命中配置或配置地址格式不合法，发布会直接报错终止
- 发布前会检查文件名结尾是否包含 `_yyyymmdd`；若缺少则按 `开始日期` 自动补上对应后缀
- 若文件名仍带旧规则的 `YYYY-MM-DD` 开头，则发布时会自动移除旧前缀
- `任务名称` 为空时，发布后会自动回填为当前文档文件名，但会忽略开头的“数字-”前缀
- `开始日期`、`结束日期` 必填，且要求 `YYYY-MM-DD` 格式
- Issue 标题使用 `【相关合同】【相关软件】文章名称`，其中 `文章名称` 会保留文件名中已有的 `_yyyymmdd` 后缀，但会忽略开头的“数字-”前缀
- Issue 指派人取自最后一个“任务安排”表中的 `执行人` 列，按表格数据行去重后批量同步到 GitLab
- 发布成功后，会将最后一个“任务安排”表中的 `执行人` 回写到 frontmatter `执行人`，格式为 `[[张三]]` 这种 YAML 数组
- 发布后会将 frontmatter `开始日期`、`结束日期` 同步到 GitLab Issue 右侧日期组件

`软件项目映射` 在设置页中按键值对逐行维护，支持新增一行、删除一行和修改当前行。每行包含：

- 软件名称
- 完整 GitLab 项目 URL，例如 `https://git.sansi.net:6101/group/project-a`

发布时会更新文档中最后一个“任务安排”表：

- 若表中不存在 `PLM任务名称` 列，则会在第一列自动补上 `PLM任务名称` 列
- 若表中已存在 `PLM任务名称` 列，则直接复用该列
- 按每一行生成并更新 `【合同名称】【软件名称】任务名称-任务类型_yyyymmdd`
- 保留其余列内容
- 将每一行的 `时间范围` 更新为 `开始日期～结束日期`

### `整理线上记录`

`整理线上记录` 仅对当前打开的 Markdown 文档生效，行为规则如下：

- 当前文件扩展名必须为 `.md`
- 会读取当前笔记正文中 `## 千问记录` 标题下的第一个可用千问链接
- 若 `## 千问记录` 区块不存在，或区块下没有可用链接，则会直接报错
- 若链接不是受支持的千问实时记录地址，则会直接报错

当前仅支持千问实时记录链接：

- `https://www.qianwen.com/efficiency/U/...`
- `https://www.qianwen.com/efficiency/doc/transcripts/...`

- 执行后会从页面中提取全文概要、章节速览和待办事项，并整理成固定区块追加到正文末尾
- 若重复执行，会替换上一次生成的整理结果，而不是重复追加

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
