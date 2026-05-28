# AI Git Branch Diff Review — Code Wiki

> 本文档是 `ai-git-branch-diff-review` VS Code 扩展的结构化代码百科，涵盖项目架构、模块职责、关键类与函数、依赖关系及运行方式。

---

## 一、项目概述

**项目名称**: `ai-git-branch-diff-review`  
**类型**: VS Code 扩展（Extension）  
**核心功能**: 在工作区 Git 仓库中选择目标分支，与当前分支做 diff 对比，通过 DeepSeek API 生成结构化代码审查报告（Markdown）。  
**主要技术栈**: TypeScript、VS Code Extension API、OpenAI SDK、simple-git  

---

## 二、项目结构

```
git-ai-review/
├── .vscode/                  # VS Code 调试与任务配置
│   ├── launch.json           # 调试启动配置（F5 启动扩展开发主机）
│   └── tasks.json            # 任务定义
├── media/
│   └── icon.png              # 扩展图标
├── src/                      # 源代码（TypeScript）
│   ├── extension.ts          # 扩展入口：命令注册与主流程编排
│   ├── gitService.ts         # Git 操作封装：分支、diff 获取
│   ├── llmService.ts         # LLM 调用：DeepSeek API 交互与分块策略
│   ├── prompts.ts            # 提示词模板：Review Prompt / Merge Prompt
│   └── reportGenerator.ts    # 报告生成：Markdown 文件生成与自动打开
├── out/                      # 编译输出（构建产物，不提交）
├── package.json              # 扩展清单：命令、配置、依赖、脚本
├── tsconfig.json             # TypeScript 编译配置
├── README.md                 # 用户文档
└── AGENTS.md                 # 仓库开发指南
```

---

## 三、整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                      VS Code 扩展宿主                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ 命令注册     │  │ 设置页面     │  │ 进度通知 / 消息框    │  │
│  │ extension.ts│  │ (内置)       │  │ (VS Code API)       │  │
│  └──────┬──────┘  └─────────────┘  └─────────────────────┘  │
└─────────┼───────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│                      主流程 runReview()                       │
│  1. 检查工作区 → 2. 检查 API Key → 3. 初始化 GitService      │
│  4. 选择目标分支 → 5. 获取 Diff → 6. 确认生成报告              │
│  7. 调用 LLMService → 8. 生成并打开报告                        │
└─────────────────────────────────────────────────────────────┘
          │
    ┌─────┴─────┬─────────────┐
    ▼           ▼             ▼
┌────────┐ ┌──────────┐ ┌──────────────┐
│GitService│ │LLMService│ │ReportGenerator│
│(Git 层) │ │(AI 层)   │ │(输出层)      │
└────────┘ └──────────┘ └──────────────┘
    │           │             │
    ▼           ▼             ▼
┌────────┐ ┌──────────┐ ┌──────────────┐
│simple- │ │ OpenAI   │ │   fs / path  │
│git     │ │ SDK      │ │   VS Code API│
└────────┘ └──────────┘ └──────────────┘
```

### 数据流说明

1. **extension.ts** 作为扩展入口，注册两个命令：`git-ai-review.start` 和 `git-ai-review.openSettings`。
2. 用户执行 `start` 命令后，`runReview()` 按序协调各模块：
   - 通过 **GitService** 获取分支列表与 diff 内容；
   - 通过 **LLMService** 将 diff 分块并调用 DeepSeek API 生成审查内容；
   - 通过 **ReportGenerator** 将审查内容写入 Markdown 文件并自动打开。

---

## 四、模块职责详解

### 4.1 extension.ts — 扩展入口与主流程编排

| 项目 | 说明 |
|------|------|
| **职责** | 注册 VS Code 命令，编排整个 Review 流程的 8 个步骤 |
| **导出** | `activate(context)`、`deactivate()` |
| **关键函数** | `runReview()`、`prioritizeBranches()` |

#### 关键函数

- **`activate(context: vscode.ExtensionContext)`**  
  注册两个命令：
  - `git-ai-review.start` → 触发 `runReview()`
  - `git-ai-review.openSettings` → 打开本扩展的设置页

- **`runReview(): Promise<void>`**  
  主流程函数，按以下步骤执行：
  1. 检查工作区是否打开；
  2. 检查 DeepSeek API Key 是否配置；
  3. 初始化 `GitService` 并获取当前分支；
  4. 弹出 QuickPick 选择目标分支（base），常用分支置顶；
  5. 显示进度通知，获取两个分支的 diff；
  6. 确认是否生成报告；
  7. 调用 `LLMService.generateReview()` 生成审查内容；
  8. 调用 `ReportGenerator.generate()` 写入文件并打开。

- **`prioritizeBranches(branches: string[]): string[]`**  
  将常用分支（`main`、`master`、`develop`、`dev`、`release`、`staging`）排在前面，其余按字母序排列。

---

### 4.2 gitService.ts — Git 操作封装

| 项目 | 说明 |
|------|------|
| **职责** | 封装所有 Git 操作：分支查询、diff 获取、分支存在性检查 |
| **导出** | `GitService` 类、`FileDiff` 接口、`DiffResult` 接口 |
| **依赖** | `simple-git` |

#### 接口定义

```typescript
interface FileDiff {
  filePath: string;   // 文件相对路径
  additions: number;  // 新增行数
  deletions: number;  // 删除行数
  diff: string;       // 完整 diff 文本
}

interface DiffResult {
  baseBranch: string;
  headBranch: string;
  fileDiffs: FileDiff[];
  totalAdditions: number;
  totalDeletions: number;
}
```

#### GitService 类

| 方法 | 说明 |
|------|------|
| `constructor(workspaceRoot: string)` | 使用 `simpleGit(workspaceRoot)` 初始化 Git 客户端 |
| `getCurrentBranch(): Promise<string>` | 获取当前分支名 |
| `getLocalBranches(): Promise<string[]>` | 获取所有本地分支 |
| `getRemoteBranches(): Promise<string[]>` | 获取远程分支，去除 `origin/` 前缀 |
| `getDiff(baseBranch, headBranch): Promise<DiffResult>` | 获取两分支间按文件拆分的 diff，统计增删行数 |
| `ensureBranchExists(branch): Promise<void>` | 私有方法：检查分支是否存在，不存在则尝试 `fetch` |

---

### 4.3 llmService.ts — LLM 调用与分块策略

| 项目 | 说明 |
|------|------|
| **职责** | 管理 DeepSeek API 配置、diff 分块、调用 LLM、合并多段结果 |
| **导出** | `LLMService` 类、`LLMConfig` 接口、`getLLMConfig()` |
| **依赖** | `openai`（DeepSeek API 兼容 OpenAI 协议）、`vscode` |

#### 接口定义

```typescript
interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  language: string;
  maxCharsPerChunk: number;
}
```

#### LLMService 类

| 方法 | 说明 |
|------|------|
| `constructor(config: LLMConfig)` | 初始化 OpenAI 客户端，`baseURL` 自动拼接 `/v1` |
| `generateReview(diffResult, onProgress?): Promise<string>` | 核心方法：判断 diff 大小，决定一次性或分块处理 |
| `chunkFiles(fileDiffs, maxChars): FileDiff[][]` | 私有方法：将文件按字符数分块，超大文件单独截断 |
| `callLLM(prompt): Promise<string>` | 私有方法：调用 DeepSeek Chat API，处理 401/429/网络错误 |

#### 分块策略

- **小 diff**（总字符数 <= `maxCharsPerChunk`，默认 50000）：一次性发送全部文件。
- **大 diff**：按文件拆分为多个块，每块不超过阈值；若单个文件超长，则截断后单独成块。
- **多段合并**：若产生多个分块，先分别获取 Review，再调用 `buildMergePrompt` 合并为一份完整报告。

---

### 4.4 prompts.ts — 提示词模板

| 项目 | 说明 |
|------|------|
| **职责** | 提供结构化提示词，确保 LLM 输出格式统一 |
| **导出** | `buildReviewPrompt(...)`、`buildMergePrompt(...)` |

#### buildReviewPrompt

为单次 diff 生成审查提示，要求 LLM 按以下结构输出：

1. **改动概述** — 核心目的、涉及模块、变更规模
2. **逐文件分析** — 变更类型、改动说明、代码质量、潜在问题
3. **关键风险与影响** — 破坏性变更、模块间影响、安全性、性能、数据与配置
4. **测试建议** — 新增测试、回归测试、边界条件
5. **总结与建议** — 整体质量星级、是否建议合并、阻塞项、优化建议

#### buildMergePrompt

用于将多个分块的独立 Review 结果合并为一份完整报告，要求：
- 去除重复内容
- 统一格式和风格
- 综合所有分组的风险点给出总体评估
- 保持上述五段式结构

---

### 4.5 reportGenerator.ts — 报告生成

| 项目 | 说明 |
|------|------|
| **职责** | 将 diff 统计与 LLM 审查内容整合为 Markdown 文件，自动打开 |
| **导出** | `ReportGenerator` 类 |
| **依赖** | `vscode`、`path`、`fs` |

#### ReportGenerator 类

| 方法 | 说明 |
|------|------|
| `static async generate(workspaceRoot, diffResult, reviewContent, customOutputDir?): Promise<string>` | 生成 `.md` 文件并自动在编辑器中打开，返回文件路径 |
| `private static buildReportMarkdown(diffResult, reviewContent, timestamp): string` | 拼接完整 Markdown 内容，包含基本信息表、变更文件列表、LLM 审查内容 |

#### 输出文件命名规则

```
review-{headBranch}-{timestamp}.md
# 示例：review-feature-login-2024-01-15T09-30-00.md
```

---

## 五、关键类与函数速查表

| 文件 | 名称 | 类型 | 职责 |
|------|------|------|------|
| `extension.ts` | `activate` | 函数 | 扩展激活入口，注册命令 |
| `extension.ts` | `runReview` | 函数 | 主流程编排（8 步） |
| `extension.ts` | `prioritizeBranches` | 函数 | 分支排序：常用分支置顶 |
| `gitService.ts` | `GitService` | 类 | Git 操作封装 |
| `gitService.ts` | `FileDiff` | 接口 | 单文件 diff 数据结构 |
| `gitService.ts` | `DiffResult` | 接口 | 完整 diff 结果数据结构 |
| `llmService.ts` | `LLMService` | 类 | LLM 调用与分块策略 |
| `llmService.ts` | `LLMConfig` | 接口 | LLM 配置数据结构 |
| `llmService.ts` | `getLLMConfig` | 函数 | 从 VS Code 配置读取 LLM 参数 |
| `prompts.ts` | `buildReviewPrompt` | 函数 | 生成单次审查提示词 |
| `prompts.ts` | `buildMergePrompt` | 函数 | 生成多段合并提示词 |
| `reportGenerator.ts` | `ReportGenerator` | 类 | Markdown 报告生成与打开 |

---

## 六、依赖关系

### 6.1 外部依赖（package.json）

| 包名 | 版本 | 用途 |
|------|------|------|
| `openai` | `^4.70.0` | 调用 DeepSeek API（兼容 OpenAI 协议） |
| `simple-git` | `^3.27.0` | 封装 Git 命令，获取分支与 diff |
| `@types/node` | `^20.11.0` | Node.js 类型定义 |
| `@types/vscode` | `^1.80.0` | VS Code Extension API 类型定义 |
| `typescript` | `^5.3.0` | TypeScript 编译器 |
| `@vscode/vsce` | `^2.22.0` | 打包 `.vsix` 扩展包 |

### 6.2 模块间依赖图

```
extension.ts
    ├── gitService.ts  ──> simple-git
    ├── llmService.ts  ──> openai, vscode
    │       └── prompts.ts
    └── reportGenerator.ts ──> vscode, fs, path
```

- **`extension.ts`** 依赖所有业务模块，负责流程编排。
- **`llmService.ts`** 依赖 `prompts.ts` 获取提示词模板。
- **`reportGenerator.ts`** 依赖 `gitService.ts` 的 `DiffResult` 类型。

---

## 七、配置项（Settings）

扩展在 `package.json` 中注册了以下配置项，用户可通过 VS Code 设置面板修改：

| 配置键 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `git-ai-review.deepseekApiKey` | `string` | `""` | DeepSeek API Key（sk-xxx） |
| `git-ai-review.deepseekBaseUrl` | `string` | `https://api.deepseek.com` | DeepSeek API Base URL |
| `git-ai-review.model` | `string` | `deepseek-chat` | 可选模型：deepseek-v4-pro / deepseek-v4-flash / deepseek-chat / deepseek-coder / deepseek-reasoner |
| `git-ai-review.language` | `string` | `中文` | 报告语言：中文 / English |
| `git-ai-review.maxCharsPerChunk` | `number` | `50000` | 单次发送给 LLM 的最大字符数（超出自动分块） |
| `git-ai-review.reportOutputDir` | `string` | `""` | 报告输出目录（默认为工作区根目录） |

---

## 八、项目运行方式

### 8.1 开发环境准备

```bash
# 1. 安装依赖
npm install

# 2. 编译 TypeScript
npm run compile

# 3. 开发模式（监听文件变化自动编译）
npm run watch
```

### 8.2 调试与测试

- **启动扩展开发主机**：在 VS Code 中按 `F5`，会打开一个新的 Extension Development Host 窗口。
- **手动测试步骤**：
  1. 在开发主机中打开一个 Git 仓库；
  2. 按 `Ctrl+Shift+P` 打开命令面板；
  3. 执行 `Git AI Review: Compare & Review Branch`；
  4. 按提示选择目标分支，确认生成报告；
  5. 检查生成的 Markdown 报告内容。

### 8.3 构建与打包

```bash
# 运行 ESLint 检查
npm run lint

# 编译项目
npm run compile

# 打包为 .vsix 文件
npm run package
```

### 8.4 安装与使用

1. 在 VS Code 设置中搜索 `git-ai-review`，配置 `deepseekApiKey`；
2. （可选）修改模型、报告语言、分块大小、输出目录；
3. 打开命令面板执行 `Git AI Review: Compare & Review Branch`；
4. 选择目标分支，等待 AI 生成报告；
5. 报告会自动在工作区根目录（或指定目录）生成并打开。

---

## 九、数据结构与类型关系

```
DiffResult
    ├── baseBranch: string
    ├── headBranch: string
    ├── fileDiffs: FileDiff[]
    │       ├── filePath: string
    │       ├── additions: number
    │       ├── deletions: number
    │       └── diff: string
    ├── totalAdditions: number
    └── totalDeletions: number

LLMConfig
    ├── apiKey: string
    ├── baseUrl: string
    ├── model: string
    ├── language: string
    └── maxCharsPerChunk: number
```

---

## 十、错误处理策略

| 模块 | 错误场景 | 处理方式 |
|------|----------|----------|
| `extension.ts` | 未打开工作区 | `showErrorMessage("请先打开一个工作区文件夹")` |
| `extension.ts` | 未配置 API Key | `showErrorMessage("请先配置 DeepSeek API Key", "去配置")` |
| `extension.ts` | 当前目录非 Git 仓库 | `showErrorMessage("当前工作区不是 Git 仓库")` |
| `extension.ts` | 无可比较分支 | `showWarningMessage("没有可比较的分支")` |
| `extension.ts` | 获取 Diff 失败 | `showErrorMessage("获取 Diff 失败: ${err.message}")` |
| `extension.ts` | 生成报告失败 | `showErrorMessage("生成报告文件失败: ${err.message}")` |
| `llmService.ts` | API Key 无效 (401) | 抛出 "DeepSeek API Key 无效，请检查设置" |
| `llmService.ts` | 请求频率超限 (429) | 抛出 "DeepSeek API 请求频率超限，请稍后重试" |
| `llmService.ts` | 网络连接失败 | 抛出 "无法连接 DeepSeek API (${baseUrl})" |
| `llmService.ts` | LLM 返回空内容 | 抛出 "LLM 返回空内容" |
| `gitService.ts` | 分支不存在 | 尝试 `fetch`，仍失败则抛出 "分支 \"${branch}\" 不存在" |

---

## 十一、安全与注意事项

- **API Key 安全**：切勿将包含 `git-ai-review.deepseekApiKey` 的 API 密钥提交到仓库。
- **报告敏感性**：生成的审查报告可能包含私有分支的代码差异或分析结果，请妥善保管。
- **分块截断提示**：当单个文件 diff 超过 `maxCharsPerChunk` 时，会在 diff 末尾添加 `// ... [diff 已截断，内容过长] ...` 提示。

---

*本文档由项目源码分析自动生成，与代码保持同步更新。*
