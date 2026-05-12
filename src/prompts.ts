export type DocumentType = "review" | "tech-spec";

export function buildReviewPrompt(
    baseBranch: string,
    headBranch: string,
    fileDiffs: { filePath: string; diff: string }[],
    language: string = "中文"
  ): string {
    const diffBlock = fileDiffs
      .map((f) => `### 文件: ${f.filePath}\n\`\`\`diff\n${f.diff}\n\`\`\``)
      .join("\n\n");
  
    const langInstruction = language === "English" ? "Please respond in English." : "请用中文回复。";
  
    return `你是一位资深软件工程师和代码审查专家。请对以下 Git 分支差异进行详细的 Code Review。
  
  ## 上下文信息
  - **基准分支 (base)**: ${baseBranch}
  - **当前分支 (head)**: ${headBranch}
  - **变更文件数**: ${fileDiffs.length}
  
  ## Diff 内容
  ${diffBlock}
  
  ---
  
  ${langInstruction}
  
  请严格按照以下 Markdown 结构输出报告：
  
  ## 一、改动概述
  用 2-3 段话总结：
  - 本次变更的核心目的
  - 涉及的主要模块/功能
  - 变更的规模和范围
  
  ## 二、逐文件分析
  
  对每个变更文件，按以下格式输出：
  
  ### \`文件路径\`
  - **变更类型**: 新增 / 修改 / 删除 / 重构
  - **改动说明**: 具体改了什么
  - **代码质量**: 好的方面和需要改进的地方
  - **潜在问题**: 可能的 Bug 或风险
  
  ## 三、关键风险与影响
  
  按以下维度逐一检查：
  
  ### 🔴 破坏性变更 (Breaking Changes)
  列出所有可能破坏现有功能的变更，如果没有则写"无"
  
  ### 🟡 模块间影响
  分析变更对其他模块、服务、组件的影响链路
  
  ### 🔵 安全性
  - 是否有注入风险、敏感信息泄露、权限问题
  - 是否正确处理了用户输入
  
  ### ⚡ 性能影响
  - 是否引入性能退化
  - 是否有 N+1 查询、内存泄漏、不必要的计算等问题
  
  ### 🗄️ 数据与配置
  - 是否需要数据库迁移
  - 是否需要配置变更
  - 是否需要更新环境变量
  
  ## 四、测试建议
  
  ### 建议新增的测试用例
  列出具体的测试场景
  
  ### 重点回归测试
  列出需要重点回归的功能
  
  ### 边界条件
  列出需要注意的边界情况
  
  ## 五、总结与建议
  
  | 项目 | 结论 |
  |------|------|
  | 整体质量 | ⭐⭐⭐⭐⭐ (1-5星) |
  | 是否建议合并 | ✅ 建议合并 / ⚠️ 有条件合并 / ❌ 不建议合并 |
  | 合并前必须解决 | 有序列表，列出阻塞项，且附带对应的相对文件路径 |
  | 合并后建议优化 | 有序列表，列出非阻塞的改进建议，且附带对应的相对文件路径 |
  
  用一段话做最终总结。`;
  }
  
  /**
   * 用于分块合并的 prompt
   */
  export function buildMergePrompt(
    baseBranch: string,
    headBranch: string,
    partialReviews: string[],
    language: string = "中文"
  ): string {
    const langInstruction = language === "English" ? "Please respond in English." : "请用中文回复。";
  
    const parts = partialReviews
      .map((r, i) => `### 第 ${i + 1} 部分\n\n${r}`)
      .join("\n\n---\n\n");
  
    return `以下是 Git 分支 "${headBranch}" 相对于 "${baseBranch}" 的多个文件分组的独立 Review 结果。
  请将它们合并为一份完整、连贯的 Code Review 报告。
  
  要求：
  1. 去除重复内容
  2. 统一格式和风格
  3. 综合所有分组的风险点给出总体评估
  4. 保持以下结构：改动概述 → 逐文件分析 → 关键风险与影响 → 测试建议 → 总结与建议
  
  ${langInstruction}
  
  ## 各分组 Review 结果
  ${parts}
  
  请输出合并后的完整报告：`;
}

/**
 * 生成前端技术方案文档的 prompt
 * 根据代码变更反向推导前端实现方案
 */
export function buildTechSpecPrompt(
  baseBranch: string,
  headBranch: string,
  fileDiffs: { filePath: string; diff: string }[],
  language: string = "中文"
): string {
  const diffBlock = fileDiffs
    .map((f) => `### 文件: ${f.filePath}\n\`\`\`diff\n${f.diff}\n\`\`\``)
    .join("\n\n");

  const langInstruction = language === "English" ? "Please respond in English." : "请用中文回复。";

  return `你是一位资深前端技术专家。请根据以下 Git 分支的代码变更，反向推导出前端技术方案文档。

## 上下文信息
- **基准分支 (base)**: ${baseBranch}
- **实现分支 (head)**: ${headBranch}
- **变更文件数**: ${fileDiffs.length}

## 变更内容（Diff）
${diffBlock}

---

${langInstruction}

请按以下精简结构输出前端技术方案：

## 一、需求概述
- 本次变更要解决什么问题
- 涉及的主要页面/组件/功能

## 二、技术实现

### 2.1 组件/页面结构
- 新增或修改的组件清单
- 组件关系与职责

### 2.2 关键逻辑
- 核心交互逻辑说明
- 状态管理方案（如有）

### 2.3 接口对接
- 调用的 API 接口
- 数据流转方式

## 三、实现细节

对每个变更文件简要说明：

### \`文件路径\`
- **作用**: 该文件承担什么职责
- **要点**: 关键实现或技术点

## 四、依赖与配置

- 新增依赖包及用途
- 新增配置项或环境变量

## 五、测试与验收

- 需要验证的功能点
- 关键交互的测试建议

---

用一段话总结本次变更的技术要点。`;
}

/**
 * 用于分块合并前端技术方案的 prompt
 */
export function buildTechSpecMergePrompt(
  baseBranch: string,
  headBranch: string,
  partialSpecs: string[],
  language: string = "中文"
): string {
  const langInstruction = language === "English" ? "Please respond in English." : "请用中文回复。";

  const parts = partialSpecs
    .map((r, i) => `### 第 ${i + 1} 部分\n\n${r}`)
    .join("\n\n---\n\n");

  return `以下是 Git 分支 "${headBranch}" 相对于 "${baseBranch}" 的多个文件分组独立生成的前端技术方案。
请将它们合并为一份完整、连贯的前端技术方案文档。

要求：
1. 去除重复内容
2. 统一格式和风格
3. 综合所有分组给出总体实现概览
4. 保持以下结构：需求概述 → 技术实现 → 实现细节 → 依赖与配置 → 测试与验收

${langInstruction}

## 各分组技术方案
${parts}

请输出合并后的完整前端技术方案：`;
}
  