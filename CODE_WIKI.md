# AI Git Branch Diff Review — Code Wiki

> 本文档是 `ai-git-branch-diff-review` VS Code 扩展的结构化代码百科，涵盖项目架构、模块职责、关键类与函数、依赖关系、运行方式与错误处理策略。
> 文档与源码一一对应，是修改本项目前必读的权威参考（参考 `.cursor/rules/code-wiki.mdc` 约定）。

---

## 一、项目概述

| 项目 | 说明 |
|------|------|
| **名称** | `ai-git-branch-diff-review` |
| **类型** | VS Code 扩展（Extension） |
| **核心功能** | 在工作区 Git 仓库中选择基准分支，与当前检出分支做 diff 对比，通过 DeepSeek API 生成结构化 Markdown 报告。支持两种文档类型：**代码审查（review）** 与 **前端技术方案（tech-spec，反向推导）** |
| **主要技术栈** | TypeScript、VS Code Extension API、LangChain（`@langchain/core` + `@langchain/deepseek` + `@langchain/openai`）、`simple-git` |
| **目标用户** | 合并请求（MR/PR）前需要快速 AI 辅助 Review 的开发者 |
| **仓库** | https://github.com/tzy168/git-ai-review |

---

## 二、项目结构

```
git-ai-review/
├── .cursor/rules/
│   └── code-wiki.mdc        # Cursor 规则：每次新对话先读 CODE_WIKI.md
├── .vscode/
│   ├── launch.json          # 调试启动配置（F5 启动 Extension Development Host）
│   └── tasks.json           # 任务定义（npm: compile 预启动任务）
├── media/
│   └── icon.png             # 扩展图标
├── src/                     # 源代码（TypeScript，rootDir）
│   ├── extension.ts         # 扩展入口：命令注册与 8 步主流程编排
│   ├── gitService.ts        # Git 操作封装：分支、diff、merge-base
│   ├── llmService.ts        # LLM 配置读取 + LLMService 门面（错误映射）
│   ├── prompts.ts           # LangChain ChatPromptTemplate 模板（review / tech-spec / merge）
│   ├── reportGenerator.ts   # Markdown 报告生成与自动打开
│   └── llm/                 # LLM 子层（LangChain LCEL 实现）
│       ├── modelFactory.ts   # createChatModel()：DeepSeek ChatModel 工厂
│       ├── chunker.ts         # chunkFiles()：diff 按字符分块 + 超长文件截断
│       ├── chains.ts          # LCEL 链构建：review / tech-spec / merge（4 条链）
│       └── reviewPipeline.ts  # runReviewPipeline()：小 diff 直发 / 大 diff 并发池 + 合并
├── out/                     # 编译输出（构建产物，gitignore，不提交）
├── package.json             # 扩展清单：命令、配置、依赖、脚本
├── tsconfig.json            # TypeScript 编译配置（commonjs / ES2022 / strict）
├── pnpm-lock.yaml           # pnpm 锁文件
├── package-lock.json        # npm 锁文件（与 pnpm 并存）
├── .vscodeignore            # vsce 打包时忽略列表
├── README.md                # 用户文档
├── CLAUDE.md                # Claude Code 协作指南
└── AGENTS.md                # 仓库开发指南（引用 CLAUDE.md）
```

---

## 三、整体架构

### 3.1 分层视图

```
┌────────────────────────────────────────────────────────────────┐
│                       VS Code 扩展宿主                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ 命令注册      │  │ 设置页面      │  │ 进度通知 / 消息框     │  │
│  │ extension.ts │  │ (内置)        │  │ (VS Code API)        │  │
│  └──────┬───────┘  └──────────────┘  └──────────────────────┘  │
└─────────┼──────────────────────────────────────────────────────┘
          │
          ▼
┌────────────────────────────────────────────────────────────────┐
│                  主流程 runReview() (extension.ts)              │
│  1.检查工作区 → 2.检查 API Key → 3.初始化 GitService            │
│  4.选择目标分支 → 5.获取 Diff → 6.选择文档类型 (review/tech-spec) │
│  7.调用 LLMService.generate() → 8.生成并打开报告                 │
└────────────────────────────────────────────────────────────────┘
          │
    ┌─────┴──────┬───────────────┐
    ▼            ▼               ▼
┌────────┐  ┌────────────┐  ┌──────────────┐
│GitService│ │ LLMService │ │ReportGenerator│
│(Git 层) │ │ (LLM 门面)  │ │(输出层)       │
└────┬───┘  └─────┬──────┘  └──────┬───────┘
     │            │                │
     ▼            ▼                ▼
┌────────┐  ┌──────────────────┐  ┌──────────────┐
│simple- │  │ src/llm/         │  │ fs / path     │
│git     │  │  ├─modelFactory  │  │ VS Code API   │
└────────┘  │  ├─chunker       │  └──────────────┘
            │  ├─chains        │
            │  └─reviewPipeline │
            │       │           │
            │       ▼           │
            │  @langchain/core  │
            │  @langchain/      │
            │   deepseek        │
            └──────────────────┘
```

### 3.2 数据流

1. **`extension.ts`** 注册两个命令：`git-ai-review.start`（→ `runReview()`）、`git-ai-review.openSettings`。
2. `runReview()` 按序协调各模块：
   - 通过 **GitService** 获取分支列表、`merge-base` 与按文件拆分的 diff；
   - 通过 **LLMService** 调用 LangChain 编排管线生成内容（review 或 tech-spec）；
   - 通过 **ReportGenerator** 把内容写入 Markdown 文件并自动在编辑器打开。
3. **LLMService.generate()** 仅做参数与错误映射，实际编排在 `src/llm/reviewPipeline.ts`：
   - 小 diff（总字符数 ≤ `maxCharsPerChunk`）→ 单次 LCEL 链 invoke；
   - 大 diff → `chunkFiles()` 分块 → 并发池（`DEFAULT_CONCURRENCY = 3`）逐块 invoke → 合并链 invoke 合成最终报告。

---

## 四、模块职责详解

### 4.1 `src/extension.ts` — 扩展入口与主流程编排

| 项目 | 说明 |
|------|------|
| **职责** | 注册 VS Code 命令，编排整个 Review/Tech-Spec 流程的 8 个步骤 |
| **导出** | `activate(context)`、`deactivate()`（空实现） |
| **依赖** | `./gitService`、`./llmService`、`./reportGenerator`、`./prompts`（仅类型 `DocumentType`） |

#### 关键函数

- **`activate(context: vscode.ExtensionContext)`**  
  注册两个命令：
  - `git-ai-review.start` → 触发 `runReview()`；
  - `git-ai-review.openSettings` → 调用 VS Code 内置命令打开 `@ext:refe.git-ai-review` 设置页。

- **`runReview(): Promise<void>`**（私有，未导出）  
  主流程函数，按以下 8 步执行：
  1. 检查工作区是否打开（无则 `showErrorMessage` 退出）；
  2. 调 `getLLMConfig()` 读取配置，检查 `apiKey`，未配置时弹"去配置"按钮；
  3. 初始化 `GitService`，`getCurrentBranch()` 失败则提示"非 Git 仓库"；
  4. 拉取本地 + 远程分支，去重、剔除当前分支，`prioritizeBranches()` 常用分支置顶，QuickPick 让用户选 `base`；
  5. 用 `withProgress` 包裹 `git.getDiff(baseBranch, currentBranch)`，无差异时提示并退出；
  6. 第二个 QuickPick 让用户选文档类型：**代码审查报告**（`review`）或 **技术方案文档**（`tech-spec`）；
  7. `withProgress` 包裹 `llm.generate(diffResult, docType.value, onProgress)`；
  8. 调 `ReportGenerator.generate(...)` 写入并打开 Markdown，弹"已生成"提示。

- **`prioritizeBranches(branches: string[]): string[]`**（私有）  
  将 `main`、`master`、`develop`、`dev`、`release`、`staging`（不区分大小写、子串匹配）排在前面；两个分支都匹配时按上述顺序排序；都不匹配时按 `localeCompare` 字母序。

---

### 4.2 `src/gitService.ts` — Git 操作封装

| 项目 | 说明 |
|------|------|
| **职责** | 封装所有 Git 操作：分支查询、merge-base、按文件拆分 diff、增删行统计、分支存在性检查（含自动 fetch） |
| **导出** | `GitService` 类、`FileDiff` 接口、`DiffResult` 接口 |
| **依赖** | `simple-git`（唯一 Git 接口，CLAUDE.md 约定禁止 shell out 到 git CLI） |

#### 接口定义

```typescript
interface FileDiff {
  filePath: string;     // 文件相对路径
  additions: number;    // 新增行数（按 ^+[^+] 正则统计）
  deletions: number;    // 删除行数（按 ^-[^-] 正则统计）
  diff: string;         // 该文件的完整 diff 文本
}

interface DiffResult {
  baseBranch: string;
  headBranch: string;
  fileDiffs: FileDiff[];
  totalAdditions: number;
  totalDeletions: number;
}
```

#### `GitService` 类

| 方法 | 可见性 | 说明 |
|------|--------|------|
| `constructor(workspaceRoot: string)` | public | 使用 `simpleGit(workspaceRoot)` 初始化 Git 客户端 |
| `getCurrentBranch(): Promise<string>` | public | 调 `git.status()` 取 `current`，无则返回 `"unknown"` |
| `getLocalBranches(): Promise<string[]>` | public | 调 `git.branchLocal()` 返回 `all` |
| `getRemoteBranches(): Promise<string[]>` | public | 调 `git.branch(["-r"])`，去除 `origin/` 前缀；失败返回 `[]` |
| `getDiff(baseBranch, headBranch): Promise<DiffResult>` | public | **核心**：先 `ensureBranchExists` → `git.raw(["merge-base", ...])` 求共同祖先 → `diffSummary([mergeBase, headBranch])` 拿文件清单 → 对每个文件再 `git.diff([mergeBase, headBranch, "--", filePath])` 取完整 diff，并按正则统计增删行 |
| `ensureBranchExists(branch): Promise<void>` | private | 本地分支列表里没有就 `git.fetch("origin", branch)`，仍失败抛 `分支 "${branch}" 不存在` |

---

### 4.3 `src/llmService.ts` — LLM 配置与门面

| 项目 | 说明 |
|------|------|
| **职责** | 从 VS Code 配置读取 LLM 参数；持有 `BaseChatModel` 实例；提供 `generate()` 统一入口并做错误映射 |
| **导出** | `LLMService` 类、`LLMConfig` 接口、`getLLMConfig()` 函数 |
| **依赖** | `vscode`、`@langchain/core`（仅类型 `BaseChatModel`）、`./llm/modelFactory`、`./llm/reviewPipeline`、`./gitService`（类型）、`./prompts`（类型） |

#### 接口定义

```typescript
interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  language: string;        // "中文" | "English"
  maxCharsPerChunk: number; // 默认 50000
}
```

#### `getLLMConfig(): LLMConfig`

从 VS Code `git-ai-review` 配置段读取。各字段代码内默认值：

| 字段 | 代码内 fallback | `package.json` 默认值 | 实际生效 |
|------|----------------|------------------------|----------|
| `apiKey` | `""` | `""` | `""` |
| `baseUrl` | `"https://api.deepseek.com"` | 同左 | 同左 |
| `model` | `"deepseek-v4-flash"` | `"deepseek-chat"` | `package.json` 默认（`deepseek-chat`）优先 |
| `language` | `"中文"` | 同左 | 同左 |
| `maxCharsPerChunk` | `50000` | 同左 | 同左 |

> ⚠️ 注意：`package.json` 默认值会被 VS Code 优先使用，代码内 fallback 仅在配置项缺失时生效。`model` 字段二者不同，实际用户未设置时拿到的是 `deepseek-chat`。

#### `LLMService` 类

| 方法 | 说明 |
|------|------|
| `constructor(config: LLMConfig)` | 持有 config，并通过 `createChatModel(config)` 创建 `BaseChatModel` 实例 |
| `generateReview(diffResult, onProgress?): Promise<string>` | **兼容旧接口**，内部转发到 `generate(diffResult, "review", onProgress)` |
| `generate(diffResult, docType, onProgress?): Promise<string>` | **统一入口**：委托 `runReviewPipeline(...)`，捕获错误并映射为用户友好文案 |

#### 错误映射表（在 `generate()` 内部）

| 触发条件 | 抛出文案 |
|----------|----------|
| `error.status === 401` | `DeepSeek API Key 无效，请检查设置` |
| `error.status === 429` | `DeepSeek API 请求频率超限，请稍后重试` |
| `error.code === "ECONNREFUSED" \|\| "ENOTFOUND"` | `无法连接 DeepSeek API (${baseUrl})` |
| `error.message === "LLM 返回空内容"` | 原样透传 |
| 其他 | `DeepSeek API 调用失败: ${message ?? error}` |

---

### 4.4 `src/prompts.ts` — LangChain 提示词模板

| 项目 | 说明 |
|------|------|
| **职责** | 以 `ChatPromptTemplate`（system + human）形式提供 4 套提示词；定义 `DocumentType` 联合类型 |
| **导出** | `DocumentType` 类型、`buildReviewPrompt()`、`buildMergePrompt()`、`buildTechSpecPrompt()`、`buildTechSpecMergePrompt()` |
| **依赖** | `@langchain/core/prompts`（`ChatPromptTemplate`） |

#### `DocumentType`

```typescript
export type DocumentType = "review" | "tech-spec";
```

#### 4 套模板

| 函数 | System 角色 | Human 模板变量 | 用途 |
|------|-------------|----------------|------|
| `buildReviewPrompt()` | `REVIEW_SYSTEM`（资深代码审查专家） | `baseBranch`、`headBranch`、`fileCount`、`diffBlock`、`language` | 单块 diff 生成审查报告 |
| `buildMergePrompt()` | `REVIEW_SYSTEM` | `baseBranch`、`headBranch`、`parts`、`language` | 合并多块审查结果 |
| `buildTechSpecPrompt()` | `TECHSPEC_SYSTEM`（资深软件架构师/技术文档专家） | 同 review | 单块 diff 反推前端技术方案 |
| `buildTechSpecMergePrompt()` | `TECHSPEC_SYSTEM` | 同 merge | 合并多块技术方案 |

#### Review 报告五段式结构

1. **改动概述** — 核心目的、涉及模块、变更规模
2. **逐文件分析** — 变更类型 / 改动说明 / 代码质量 / 潜在问题
3. **关键风险与影响** — 🔴 破坏性变更 / 🟡 模块间影响 / 🔵 安全性 / ⚡ 性能影响 / 🗄️ 数据与配置
4. **测试建议** — 新增用例 / 重点回归 / 边界条件
5. **总结与建议** — 星级、是否合并、阻塞项、优化建议（含相对文件路径）

#### Tech-Spec 报告五段式结构

1. **需求概述** — 解决什么问题、主要页面/组件/功能
2. **技术实现** — 组件结构 / 关键逻辑 / 接口对接
3. **实现细节** — 逐文件职责与要点
4. **依赖与配置** — 新增依赖包 / 配置项 / 环境变量
5. **测试与验收** — 验证功能点 / 交互测试建议

#### 合并要求（merge 模板共同点）

- 去除重复内容
- 统一格式与风格
- 综合所有分组给出总体评估
- 保持对应文档类型的五段式结构

---

### 4.5 `src/reportGenerator.ts` — 报告生成

| 项目 | 说明 |
|------|------|
| **职责** | 将 diff 统计与 LLM 内容整合为 Markdown 文件，自动在编辑器打开 |
| **导出** | `ReportGenerator` 类（全静态方法） |
| **依赖** | `vscode`、`path`、`fs`、`./gitService`（类型 `DiffResult`）、`./prompts`（类型 `DocumentType`） |

#### `ReportGenerator` 类

| 方法 | 可见性 | 说明 |
|------|--------|------|
| `generate(workspaceRoot, diffResult, content, docType?, customOutputDir?): Promise<string>` | public static | 生成 `.md` 文件，自动 `openTextDocument` + `showTextDocument`（`preview: false`），返回文件路径 |
| `buildReportMarkdown(diffResult, content, timestamp, docType?): string` | private static | 拼接完整 Markdown：标题 + 基本信息表 + 变更文件列表表 + LLM 内容 + 页脚 |

#### 输出文件命名规则

```
{prefix}-{headBranch}-{timestamp}.md
```

- `prefix`：`docType === "tech-spec"` 时为 `tech-spec`，否则 `review`；
- `timestamp`：ISO 时间戳，`:` 与 `.` 全部替换为 `-`，截断到秒（19 字符）；
- 示例：`review-feature-login-2024-01-15T09-30-00.md`、`tech-spec-feat-ui-2024-03-01T10-00-00.md`。

#### 输出目录解析

- `customOutputDir` 传入时：`path.resolve(workspaceRoot, customOutputDir)`（相对工作区根）；
- 未传：直接用 `workspaceRoot`；
- 目录不存在则 `mkdirSync({ recursive: true })` 递归创建。

---

### 4.6 `src/llm/modelFactory.ts` — 模型工厂

| 项目 | 说明 |
|------|------|
| **职责** | 创建 `BaseChatModel` 实例；是多 Provider 扩展点 |
| **导出** | `createChatModel(config: LLMConfig): BaseChatModel` |
| **依赖** | `@langchain/deepseek`（`ChatDeepSeek`）、`@langchain/core`（类型 `BaseChatModel`）、`../llmService`（类型 `LLMConfig`） |

#### 设计要点

- 所有链与 pipeline **只依赖 `BaseChatModel`**，唯一具体类型出现在此工厂；
- 未来切换 `ChatAnthropic` / `ChatOllama` / `ChatOpenAI` **只需改这一处**，调用方零改动；
- 使用官方 `@langchain/deepseek` 而非 `ChatOpenAI + baseURL`，能正确处理 `reasoning_content` 等字段；
- 兼容历史配置：`baseURL` 拼接 `/v1`（与重构前 `${baseUrl}/v1` 行为一致）。

#### 实例化参数

```typescript
new ChatDeepSeek({
  apiKey: config.apiKey,
  model: config.model,
  temperature: 0.2,     // 低温度保证稳定输出
  maxTokens: 8192,
  configuration: { baseURL: `${config.baseUrl}/v1` },
});
```

---

### 4.7 `src/llm/chunker.ts` — diff 分块器

| 项目 | 说明 |
|------|------|
| **职责** | 将 `FileDiff[]` 按字符数分块；超大单文件截断；提供 `RunnableLambda` 形式以便 LCEL 串联 |
| **导出** | `chunkFiles()` 函数、`chunkDiffFiles` RunnableLambda |
| **依赖** | `@langchain/core/runnables`（`RunnableLambda`）、`../gitService`（类型 `FileDiff`） |

#### `chunkFiles(fileDiffs: FileDiff[], maxChars: number): FileDiff[][]`

分块逻辑（源自重构前的 `LLMService.chunkFiles`）：

1. 顺序遍历文件；
2. **单文件超限**（`fd.diff.length > maxChars`）：当前块若有先封存，再把该文件 `diff` 截断到 `maxChars` 并追加 `TRUNCATE_TAIL`（`"\n\n// ... [diff 已截断，内容过长] ..."`），单独成块；
3. **放入当前块会超限**：当前块封存，开新块；
4. 否则加入当前块、累加 `currentSize`；
5. 遍历结束后若当前块非空，封存为最后一块。

#### `chunkDiffFiles`

```typescript
export const chunkDiffFiles = RunnableLambda.from(
  (input: { fileDiffs: FileDiff[]; maxChars: number }) =>
    chunkFiles(input.fileDiffs, input.maxChars)
);
```

> 注：当前 `reviewPipeline.ts` 直接调 `chunkFiles()` 函数，未使用 `chunkDiffFiles`。后者保留为 LCEL 串联扩展点。

---

### 4.8 `src/llm/chains.ts` — LCEL 链构建

| 项目 | 说明 |
|------|------|
| **职责** | 构建 4 条 LCEL（LangChain Expression Language）链：变量映射 → ChatPromptTemplate → model → StringOutputParser |
| **导出** | `ReviewChainInput`、`MergeChainInput` 接口；`buildReviewChain`、`buildTechSpecChain`、`buildMergeChain`、`buildTechSpecMergeChain` 函数；`FileDiff` 类型再导出 |
| **依赖** | `@langchain/core/runnables`（`RunnableLambda`）、`@langchain/core/output_parsers`（`StringOutputParser`）、`@langchain/core/language_models/chat_models`（`BaseChatModel` 类型）、`../prompts`、`../gitService`（类型 `FileDiff`） |

#### 输入接口

```typescript
interface ReviewChainInput {
  baseBranch: string;
  headBranch: string;
  fileDiffs: { filePath: string; diff: string }[];
  language: string;
}

interface MergeChainInput {
  baseBranch: string;
  headBranch: string;
  partialResults: string[];
  language: string;
}
```

#### 内部辅助函数

| 函数 | 说明 |
|------|------|
| `langInstruction(language)` | `"English"` → `"Please respond in English."`，否则 `"请用中文回复。"` |
| `renderDiffBlock(fileDiffs)` | 把 `[{filePath, diff}]` 渲染为 Markdown：`### 文件: {path}\n```diff\n{diff}\n````，多文件用 `\n\n` 拼接 |
| `toReviewVars(input): ReviewPromptVars` | 把 `ReviewChainInput` 映射为模板变量（`fileCount` 转 string、`diffBlock` 渲染、`language` 转 langInstruction） |
| `toMergeVars(input): MergePromptVars` | 把 `partialResults` 编号为 `### 第 N 部分` 并用 `\n\n---\n\n` 分隔 |

#### 4 条链的统一结构

```
RunnableLambda.from(toReviewVars | toMergeVars)
    .pipe(buildXxxPrompt())
    .pipe(model)
    .pipe(new StringOutputParser())
```

| 函数 | 映射器 | 模板 | 用途 |
|------|--------|------|------|
| `buildReviewChain(model)` | `toReviewVars` | `buildReviewPrompt()` | 单块 review |
| `buildTechSpecChain(model)` | `toReviewVars` | `buildTechSpecPrompt()` | 单块 tech-spec |
| `buildMergeChain(model)` | `toMergeVars` | `buildMergePrompt()` | 合并 review |
| `buildTechSpecMergeChain(model)` | `toMergeVars` | `buildTechSpecMergePrompt()` | 合并 tech-spec |

> 复用提示：review 与 tech-spec 的链共享 `toReviewVars`；merge 链共享 `toMergeVars`。差异仅在模板与 system 角色。

---

### 4.9 `src/llm/reviewPipeline.ts` — 编排管线

| 项目 | 说明 |
|------|------|
| **职责** | 整个 LLM 调用的编排：判断 diff 大小 → 单块直发 / 多块并发 + 合并 |
| **导出** | `runReviewPipeline()`、常量 `DEFAULT_CONCURRENCY` |
| **依赖** | `@langchain/core`（类型 `BaseChatModel`、`BaseCallbackHandler`）、`./chunker`、`./chains`、`../gitService`（类型）、`../prompts`（类型）、`../llmService`（类型 `LLMConfig`） |

#### `runReviewPipeline(diffResult, docType, model, config, onProgress?, callbacks?): Promise<string>`

**核心常量**：`DEFAULT_CONCURRENCY = 3`  
（注释说明：`RunnableParallel` 无内置并发控制，全并发有触发 429 风险，故用 Promise 池限流。后续可提为配置项。）

**执行流程**：

1. **选链**：根据 `docType` 选用 `perChunkChain`（`buildTechSpecChain` 或 `buildReviewChain`）与 `mergeChain`（`buildTechSpecMergeChain` 或 `buildMergeChain`）。
2. **计算总字符数** `totalChars`。
3. **小 diff 分支**（`totalChars <= maxCharsPerChunk`）：
   - `onProgress("正在{分析/生成技术方案} (Nk 字符)...")`；
   - `perChunkChain.invoke(buildInput(fileDiffs), invokeOptions)`；
   - 空内容抛 `"LLM 返回空内容"`；
   - 返回结果。
4. **大 diff 分支**：
   - `chunks = chunkFiles(fileDiffs, maxCharsPerChunk)`；
   - `onProgress("Diff 较大 (Nk 字符)，分 M 块...")`；
   - **并发池**：`nextIndex` 共享游标，启动 `min(DEFAULT_CONCURRENCY, chunks.length)` 个 worker；每个 worker 循环取下标 → `onProgress` 上报 → `perChunkChain.invoke(chunk)` → 写入 `partialResults[i]`；空内容抛 `"LLM 返回空内容"`；
   - `await Promise.all(workers)`；
   - **单块兜底**：`partialResults.length === 1` 时直接返回（单文件超长被截断成一块的情况）；
   - **合并**：`onProgress("正在合并各分块结果...")` → `mergeChain.invoke(mergeInput, invokeOptions)` → 空内容抛 `"LLM 返回空内容"` → 返回。

#### `callbacks` 参数

可选 `BaseCallbackHandler[]`，用于未来可观测性（耗时、日志）。当前 `extension.ts` 调用未传入。进度上报仍通过 `onProgress` 直接回调，以保留原 UX 文案。

---

## 五、关键类与函数速查表

| 文件 | 名称 | 类型 | 职责 |
|------|------|------|------|
| `extension.ts` | `activate` | 函数（导出） | 扩展激活入口，注册命令 |
| `extension.ts` | `deactivate` | 函数（导出） | 空实现 |
| `extension.ts` | `runReview` | 函数（私有） | 主流程编排（8 步） |
| `extension.ts` | `prioritizeBranches` | 函数（私有） | 常用分支置顶排序 |
| `gitService.ts` | `GitService` | 类 | Git 操作封装 |
| `gitService.ts` | `FileDiff` | 接口 | 单文件 diff 数据结构 |
| `gitService.ts` | `DiffResult` | 接口 | 完整 diff 结果数据结构 |
| `llmService.ts` | `LLMService` | 类 | LLM 调用门面（错误映射） |
| `llmService.ts` | `LLMConfig` | 接口 | LLM 配置数据结构 |
| `llmService.ts` | `getLLMConfig` | 函数 | 从 VS Code 配置读取 LLM 参数 |
| `prompts.ts` | `DocumentType` | 类型 | `"review" \| "tech-spec"` |
| `prompts.ts` | `buildReviewPrompt` | 函数 | 单块审查提示模板 |
| `prompts.ts` | `buildMergePrompt` | 函数 | 合并审查提示模板 |
| `prompts.ts` | `buildTechSpecPrompt` | 函数 | 单块技术方案提示模板 |
| `prompts.ts` | `buildTechSpecMergePrompt` | 函数 | 合并技术方案提示模板 |
| `reportGenerator.ts` | `ReportGenerator` | 类 | Markdown 报告生成与自动打开 |
| `llm/modelFactory.ts` | `createChatModel` | 函数 | DeepSeek ChatModel 工厂 |
| `llm/chunker.ts` | `chunkFiles` | 函数 | 按字符分块 + 超长截断 |
| `llm/chunker.ts` | `chunkDiffFiles` | RunnableLambda | LCEL 串联用分块器（当前未启用） |
| `llm/chains.ts` | `ReviewChainInput` | 接口 | 单块链输入 |
| `llm/chains.ts` | `MergeChainInput` | 接口 | 合并链输入 |
| `llm/chains.ts` | `buildReviewChain` | 函数 | 单块 review LCEL 链 |
| `llm/chains.ts` | `buildTechSpecChain` | 函数 | 单块 tech-spec LCEL 链 |
| `llm/chains.ts` | `buildMergeChain` | 函数 | 合并 review LCEL 链 |
| `llm/chains.ts` | `buildTechSpecMergeChain` | 函数 | 合并 tech-spec LCEL 链 |
| `llm/chains.ts` | `langInstruction` | 函数（私有） | 语言指令文本 |
| `llm/chains.ts` | `renderDiffBlock` | 函数（私有） | 渲染 diff 为 Markdown |
| `llm/chains.ts` | `toReviewVars` | 函数（私有） | 单块链变量映射 |
| `llm/chains.ts` | `toMergeVars` | 函数（私有） | 合并链变量映射 |
| `llm/reviewPipeline.ts` | `runReviewPipeline` | 函数 | 小 diff 直发 / 大 diff 并发池 + 合并 |
| `llm/reviewPipeline.ts` | `DEFAULT_CONCURRENCY` | 常量 | 并发上限 `3` |

---

## 六、依赖关系

### 6.1 外部依赖（`package.json`）

#### `dependencies`（运行时）

| 包名 | 版本 | 用途 |
|------|------|------|
| `@langchain/core` | `^1.0.0` | LCEL 运行时、`ChatPromptTemplate`、`RunnableLambda`、`StringOutputParser`、`BaseChatModel` 抽象 |
| `@langchain/deepseek` | `^1.0.0` | DeepSeek 官方 LangChain 集成（`ChatDeepSeek`），正确处理 `reasoning_content` |
| `@langchain/openai` | `^1.3.0` | OpenAI 兼容端点备用集成（工厂扩展点） |
| `simple-git` | `^3.27.0` | 封装 Git 命令，获取分支与 diff |

#### `devDependencies`（构建时）

| 包名 | 版本 | 用途 |
|------|------|------|
| `@types/node` | `^20.11.0` | Node.js 类型定义 |
| `@types/vscode` | `^1.80.0` | VS Code Extension API 类型定义 |
| `typescript` | `^5.3.0` | TypeScript 编译器 |
| `@vscode/vsce` | `^2.22.0` | 打包 `.vsix` 扩展包 |

> 注：旧的 `openai` SDK 已被 LangChain 三件套取代；`README.md` "技术栈" 段落仍提到 `openai` SDK，与实际 `package.json` 不符（以 `package.json` 为准）。

### 6.2 模块间依赖图

```
extension.ts
    ├── gitService.ts        ──> simple-git
    ├── llmService.ts        ──> @langchain/core (类型)
    │       ├── llm/modelFactory.ts  ──> @langchain/deepseek
    │       ├── llm/reviewPipeline.ts
    │       │       ├── llm/chunker.ts
    │       │       └── llm/chains.ts
    │       │              └── prompts.ts  ──> @langchain/core/prompts
    │       └── prompts.ts (类型 DocumentType)
    └── reportGenerator.ts   ──> vscode, fs, path
              └── gitService.ts (类型 DiffResult)
```

### 6.3 关键依赖方向

- **`extension.ts`** 依赖所有业务模块，是唯一编排者；
- **`llmService.ts`** 是门面层，仅做参数与错误映射，业务逻辑全在 `src/llm/`；
- **`llm/chains.ts`** 是模板与模型的粘合层，依赖 `prompts.ts`；
- **`llm/reviewPipeline.ts`** 依赖 `chains.ts` 与 `chunker.ts`，是真正的编排核心；
- **`reportGenerator.ts`** 只依赖 `gitService.ts` 的 `DiffResult` 类型与 `prompts.ts` 的 `DocumentType` 类型；
- **`llm/modelFactory.ts`** 是唯一持有具体模型类（`ChatDeepSeek`）的位置，多 Provider 扩展点。

---

## 七、配置项（Settings）

扩展在 `package.json` 的 `contributes.configuration` 中注册以下配置项，用户可通过 VS Code 设置面板修改（搜索 `git-ai-review` 或执行 `Git AI Review: Open Settings` 命令）：

| 配置键 | 类型 | 默认值 | enum | 说明 |
|--------|------|--------|------|------|
| `git-ai-review.deepseekApiKey` | `string` | `""` | — | DeepSeek API Key（`sk-xxx`），**勿提交** |
| `git-ai-review.deepseekBaseUrl` | `string` | `https://api.deepseek.com` | — | API Base URL，工厂会自动拼 `/v1` |
| `git-ai-review.model` | `string` | `deepseek-chat` | `deepseek-v4-pro` / `deepseek-v4-flash` / `deepseek-chat` / `deepseek-coder` / `deepseek-reasoner` | 使用的模型 |
| `git-ai-review.language` | `string` | `中文` | `中文` / `English` | 报告语言 |
| `git-ai-review.maxCharsPerChunk` | `number` | `50000` | — | 单次发送给 LLM 的最大字符数（超出自动分块） |
| `git-ai-review.reportOutputDir` | `string` | `""` | — | 报告输出目录（相对工作区根；空则用根目录） |

### 7.1 命令与菜单

| 命令 ID | 标题 | 触发位置 |
|---------|------|----------|
| `git-ai-review.start` | `Git AI Review: Compare & Review Branch` | 命令面板 |
| `git-ai-review.openSettings` | `Git AI Review: Open Settings` | 命令面板 |

`activationEvents`：`onCommand:git-ai-review.start`、`onCommand:git-ai-review.openSettings`。

---

## 八、项目运行方式

### 8.1 开发环境准备

```bash
# 1. 安装依赖（npm 或 pnpm 均可，二者锁文件并存）
npm install
# 或
pnpm install

# 2. 编译 TypeScript（tsc -p ./）
npm run compile

# 3. 开发模式（监听文件变化自动编译）
npm run watch
```

### 8.2 调试与测试

- **启动扩展开发主机**：在 VS Code 中按 `F5`，`.vscode/launch.json` 配置 `preLaunchTask: "npm: compile"`，会先编译再启动一个新的 Extension Development Host 窗口（`--extensionDevelopmentPath=${workspaceFolder}`）。
- **手动测试步骤**：
  1. 在开发主机中打开一个 Git 仓库；
  2. 按 `Ctrl+Shift+P`（macOS `Cmd+Shift+P`）打开命令面板；
  3. 执行 `Git AI Review: Compare & Review Branch`；
  4. 按提示选择目标分支；
  5. 选择文档类型（代码审查报告 / 技术方案文档）；
  6. 等待 AI 生成，检查工作区根目录下生成的 Markdown 报告内容。
- **无自动化测试套件**：项目未配置 `test` 脚本（仅 `pretest`），完全依赖手动测试。

### 8.3 构建与打包

```bash
# ESLint 检查（src 目录，.ts 文件）
npm run lint

# 编译项目
npm run compile

# 打包为 .vsix 文件（vsce package）
npm run package
```

打包后会在仓库根目录生成 `ai-git-branch-diff-review-<version>.vsix`。

### 8.4 安装与使用

1. 在 VS Code 设置中搜索 `git-ai-review`，配置 `deepseekApiKey`；
2. （可选）修改 `model`、`language`、`maxCharsPerChunk`、`reportOutputDir`；
3. 打开命令面板执行 `Git AI Review: Compare & Review Branch`；
4. 选择 **基准分支（base）**（扩展会对比 `base…当前分支`）；
5. 选择文档类型；
6. 等待 AI 生成，报告会自动在工作区根目录（或指定目录）生成并打开。

### 8.5 npm scripts

| 脚本 | 命令 | 说明 |
|------|------|------|
| `compile` | `tsc -p ./` | 编译 TS（rootDir=src → outDir=out） |
| `watch` | `tsc -watch -p ./` | 监听编译 |
| `lint` | `eslint src --ext ts` | ESLint 检查 |
| `package` | `vsce package` | 打 VSIX |
| `pretest` | `npm run compile` | 测试前编译钩子（无 `test` 脚本） |

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

DocumentType = "review" | "tech-spec"

ReviewChainInput  (llm/chains.ts)
    ├── baseBranch: string
    ├── headBranch: string
    ├── fileDiffs: { filePath: string; diff: string }[]
    └── language: string

MergeChainInput   (llm/chains.ts)
    ├── baseBranch: string
    ├── headBranch: string
    ├── partialResults: string[]
    └── language: string

ReviewPromptVars / MergePromptVars  (llm/chains.ts，私有)
    传给 ChatPromptTemplate 的最终变量
```

### 9.1 类型流向

```
extension.ts
   │  DiffResult
   ▼
LLMService.generate(diffResult, docType, onProgress)
   │
   ▼
runReviewPipeline(diffResult, docType, model, config, onProgress)
   │
   ├── chunkFiles(fileDiffs, maxChars)  ──> FileDiff[][]
   │
   ▼  对每个 chunk 构造 ReviewChainInput
buildReviewChain(model).invoke(input)  ──> string (partialResult)
   │
   ▼  全部 partialResults 收齐
buildMergeChain(model).invoke(MergeChainInput)  ──> string (merged)
   │
   ▼
ReportGenerator.generate(workspaceRoot, diffResult, content, docType, outputDir)
   │
   ▼
review-{headBranch}-{timestamp}.md  或  tech-spec-{headBranch}-{timestamp}.md
```

---

## 十、错误处理策略

| 模块 | 错误场景 | 处理方式 |
|------|----------|----------|
| `extension.ts` | 未打开工作区 | `showErrorMessage("请先打开一个工作区文件夹")` 后 `return` |
| `extension.ts` | 未配置 API Key | `showErrorMessage("请先配置 DeepSeek API Key", "去配置", "取消")`；点"去配置"触发 `openSettings` 命令 |
| `extension.ts` | 当前目录非 Git 仓库（`getCurrentBranch` 抛错） | `showErrorMessage("当前工作区不是 Git 仓库")` |
| `extension.ts` | 无可比较分支（仅当前分支） | `showWarningMessage("没有可比较的分支")` |
| `extension.ts` | `getDiff` 抛错 | `showErrorMessage("获取 Diff 失败: ${err.message}")` |
| `extension.ts` | diff 为空（`fileDiffs.length === 0`） | `showInformationMessage("${currentBranch} 中没有未包含在 ${baseBranch} 的提交差异")` |
| `extension.ts` | `generate` 抛错 | `showErrorMessage(err.message)`（错误文案已在 LLMService 映射） |
| `extension.ts` | `ReportGenerator.generate` 抛错 | `showErrorMessage("生成报告文件失败: ${err.message}")` |
| `llmService.ts` | API Key 无效（401） | 抛 `DeepSeek API Key 无效，请检查设置` |
| `llmService.ts` | 频率超限（429） | 抛 `DeepSeek API 请求频率超限，请稍后重试` |
| `llmService.ts` | 网络失败（`ECONNREFUSED` / `ENOTFOUND`） | 抛 `无法连接 DeepSeek API (${baseUrl})` |
| `llmService.ts` | LLM 返回空内容 | 原样透传 `"LLM 返回空内容"` |
| `llmService.ts` | 其他错误 | 抛 `DeepSeek API 调用失败: ${message ?? error}` |
| `llm/reviewPipeline.ts` | 任一 chunk invoke 返回空 | 抛 `"LLM 返回空内容"`（在 worker 内立即抛，中断并发池） |
| `llm/reviewPipeline.ts` | merge invoke 返回空 | 抛 `"LLM 返回空内容"` |
| `gitService.ts` | 分支本地不存在 | 尝试 `git.fetch("origin", branch)`，仍失败抛 `分支 "${branch}" 不存在` |
| `gitService.ts` | `getRemoteBranches` 失败 | 静默返回 `[]`（不阻塞流程） |

---

## 十一、安全与注意事项

- **API Key 安全**：`git-ai-review.deepseekApiKey` 仅保存在本机 VS Code 用户/工作区设置中；切勿将含密钥的设置文件提交到 Git。
- **Diff 内容外发**：分支差异会经 HTTPS 发往所配置的 DeepSeek（或自建兼容端点）；分支中**勿**包含密钥、令牌等敏感信息。
- **截断提示**：单文件 diff 超过 `maxCharsPerChunk` 时，会在 diff 末尾追加 `// ... [diff 已截断，内容过长] ...`，LLM 仅看到截断内容。
- **并发限流**：大 diff 并发上限固定为 `DEFAULT_CONCURRENCY = 3`，未触发 429 时性能最佳；若 DeepSeek 端有更严限制，需调小此常量（后续可提为配置项）。
- **构建产物**：`.vsix` 与 `out/` 目录均为构建产物，勿直接修改或提交；`.vscodeignore` 控制打包时排除项。
- **AI 结论仅供参考**：合并前仍需人工审查与自动化测试。
- **锁文件并存**：`package-lock.json` 与 `pnpm-lock.yaml` 同时存在；建议团队统一使用其一，避免依赖漂移。

---

## 十二、扩展点

以下是项目为未来演进预留的扩展点，修改时只需触动对应位置：

| 扩展场景 | 修改位置 | 影响范围 |
|----------|----------|----------|
| 切换 LLM Provider（Anthropic / Ollama / OpenAI） | `llm/modelFactory.ts` | 调用方零改动（已抽象为 `BaseChatModel`） |
| 新增文档类型（如 `security-audit`） | `prompts.ts` 加模板 + `DocumentType`；`chains.ts` 加链；`reviewPipeline.ts` 选链分支；`extension.ts` QuickPick 加项；`reportGenerator.ts` 加 prefix | 全链路 |
| 调整并发上限为配置项 | `reviewPipeline.ts` 读 `config`；`llmService.ts` 加字段；`package.json` 加配置 | 用户可调 |
| 启用 LCEL 串联分块（替代直接调 `chunkFiles`） | `reviewPipeline.ts` 用 `chunkDiffFiles` 串联 | 增强可组合性 |
| 接入可观测性（耗时、日志） | `runReviewPipeline` 传入 `callbacks: BaseCallbackHandler[]` | 已预留参数 |
| 限制报告输出目录在工作区内 | `reportGenerator.ts` 增加路径校验 | 防越权写入 |

---

*本文档基于源码现状生成，与代码保持同步更新。修改源码后请同步更新本文档。*
