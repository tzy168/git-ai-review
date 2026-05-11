# Git AI Review

基于 **DeepSeek** 的 [VS Code](https://code.visualstudio.com/) 扩展：在工作区 Git 仓库中选取**基准分支**，与**当前检出分支**做 diff，自动生成结构化 **Markdown** 代码审查报告，适合合并请求（MR/PR）前的快速 AI 辅助 Review。

**仓库：** [https://github.com/tzy168/git-ai-review](https://github.com/tzy168/git-ai-review)

---

## 功能概览

- 在命令面板中一键启动：**选择目标分支 → 拉取 diff → 确认后调用 LLM → 写入报告并打开**
- 支持本地与远程分支列表；`main` / `master` / `develop` 等常用分支在列表中优先展示
- 大体积 diff 按配置自动**分块**请求，避免单次超出模型上下文
- 报告语言可在设置中选 **中文** 或 **English**
- 报告文件名形如：`review-<当前分支>-<ISO时间戳>.md`，内含分支信息、变更统计、文件清单与 AI 综述

---

## 环境要求

- VS Code **≥ 1.80.0**
- 当前工作区根目录须为 **Git 仓库**
- 有效的 **DeepSeek API Key**（见 [DeepSeek 开放平台](https://platform.deepseek.com/)）

---

## 安装方式

### 从源码打包安装（开发者）

```bash
git clone https://github.com/tzy168/git-ai-review.git
cd git-ai-review
npm install
npm run compile
npm run package
```

在 VS Code 中：**扩展 → … → 从 VSIX 安装**，选择生成的 `.vsix` 文件。

若在 [Visual Studio Marketplace](https://marketplace.visualstudio.com/) 上架后，可直接在扩展市场搜索 **AI Git Branch Diff Review**（以 `package.json` 中的 `displayName` 为准）安装。

---

## 配置说明

打开设置并搜索 **`git-ai-review`**，或通过命令：**Git AI Review: Open Settings**。

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `git-ai-review.deepseekApiKey` | DeepSeek API Key（`sk-...`） | 空 |
| `git-ai-review.deepseekBaseUrl` | API 服务地址 | `https://api.deepseek.com` |
| `git-ai-review.model` | 使用的模型 | `deepseek-chat`（可选：`deepseek-v4-pro`、`deepseek-v4-flash`、`deepseek-coder`、`deepseek-reasoner` 等） |
| `git-ai-review.language` | 报告语言 | `中文` |
| `git-ai-review.maxCharsPerChunk` | 单次发给 LLM 的最大字符数，超出自动分块 | `50000` |
| `git-ai-review.reportOutputDir` | 报告输出目录（相对工作区根；留空则用根目录） | 空 |

---

## 使用步骤

1. 用 VS Code **打开文件夹**（工作区即为 Git 仓库根目录）。
2. 配置好 **DeepSeek API Key**（未配置时会提示跳转设置）。
3. 打开命令面板（`Ctrl+Shift+P` / `Cmd+Shift+P`），执行：**`Git AI Review: Compare & Review Branch`**。
4. 在列表中选择 **基准分支（base）**；扩展会对比 **`base…当前分支`**。
5. 确认差异摘要后点击 **生成报告**；完成后会在工作区写入 Markdown 并**自动打开**。

---

## 本地开发

```bash
npm install
npm run compile    # 编译 TypeScript
npm run watch      # 监听编译
```

在 VS Code 中按 **F5** 可启动 **Extension Development Host** 调试（需已配置 `.vscode/launch.json`）。

脚本说明：

- `npm run lint` — ESLint（`src` 目录）
- `npm run package` — 使用 `@vscode/vsce` 打 VSIX

---

## 技术栈（简要）

- **TypeScript** + VS Code Extension API  
- **`simple-git`** — 分支与 diff  
- **`openai`** SDK — 兼容 DeepSeek OpenAI 式接口（`baseURL` + `/v1`）

---

## 隐私与安全提示

- **API Key** 仅保存在本机 VS Code 用户/工作区设置中，请勿将含密钥的设置文件提交到 Git。
- **Diff 内容与部分元数据**会经 HTTPS 发往你所配置的 DeepSeek（或自建兼容端点）；请勿在分支差异中包含密钥、令牌等敏感信息。
- AI 结论**仅供参考**，合并前仍需人工审查与自动化测试。

---

## 许可与反馈

当前仓库未附带 `LICENSE` 时，使用前请与维护者确认授权范围。

如有问题或建议，欢迎在本仓库提交 [Issue](https://github.com/tzy168/git-ai-review/issues) 或 Pull Request。
