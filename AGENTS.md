# 仓库指南
## 项目结构与模块组织
`src/` 包含扩展源代码。关键模块有 `extension.ts` 用于命令注册、`gitService.ts` 用于分支和差异收集、`llmService.ts` 用于 DeepSeek/OpenAI 调用、`prompts.ts` 用于审查提示以及 `reportGenerator.ts` 用于生成 Markdown 输出。编译后的文件会输出到 `out/`，应将其视为构建输出。静态资源（如扩展图标）位于 `media/`。项目元数据和脚本定义在 `package.json` 中。
## 构建、测试和开发命令
- `npm install`：安装依赖项。
- `npm run compile`：将 `src/` 中的 TypeScript 编译到 `out/`。
- `npm run watch`：在开发期间对文件更改进行重新构建。
- `npm run lint`：对 `src/**/*.ts` 运行 ESLint。
- `npm run package`：使用 `vsce` 创建 VS Code 的 `.vsix` 包。
- 在 VS Code 中按 `F5`：启动扩展开发主机以进行手动测试。
## 编码风格与命名约定
使用 TypeScript，缩进为两个空格，语句末尾使用分号，与现有源代码保持一致。变量和函数采用 `camelCase`，类型和类采用 `PascalCase`，文件名应具有描述性，例如 `reportGenerator.ts`。保持模块的专注性：Git 相关逻辑放在 `gitService` 中，LLM 交互放在 `llmService` 中，UI/命令连接放在 `extension.ts` 中。提交更改前请运行 `npm run compile`；如果本地安装了 ESLint，请运行 `npm run lint`。
## 测试指南
目前没有自动测试套件被检入。通过编译来验证更改，然后在 VS Code 调试器中针对示例 Git 仓库运行扩展。对于手动检查，请验证分支选择、差异生成、API 错误处理和 Markdown 报告输出。如果您添加测试，请将它们放在专用的 `test/` 文件夹下，并将文件命名为 `*.test.ts`。
## 提交和拉取请求指南
近期的历史记录遵循约定提交风格的前缀，例如 `feat:`（新功能）、`fix:`（修复）、`refactor:`（重构）和 `docs:`（文档）。请保持提交主题简短且采用命令式语态，例如 `fix: 处理空差异响应`。拉取请求应包含简明扼要的摘要、对用户可见的影响、手动验证步骤以及 UI 或报告输出发生变化时的截图。
## 安全与配置提示
切勿提交包含 `git-ai-review.deepseekApiKey` 的 API 密钥或本地设置。将生成的审查报告视为可能敏感的信息，因为它们可能包含来自私有分支的代码差异或分析结果。