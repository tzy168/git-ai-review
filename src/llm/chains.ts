import { RunnableLambda } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  buildReviewPrompt,
  buildTechSpecPrompt,
  buildMergePrompt,
  buildTechSpecMergePrompt,
} from "../prompts";
import { FileDiff } from "../gitService";

/** 单 diff（review / tech-spec）链的输入 */
export interface ReviewChainInput {
  baseBranch: string;
  headBranch: string;
  fileDiffs: { filePath: string; diff: string }[];
  language: string;
}

/** 合并链的输入 */
export interface MergeChainInput {
  baseBranch: string;
  headBranch: string;
  partialResults: string[];
  language: string;
}

/** ChatPromptTemplate 需要的最终变量 */
interface ReviewPromptVars {
  baseBranch: string;
  headBranch: string;
  fileCount: string;
  diffBlock: string;
  language: string;
}
interface MergePromptVars {
  baseBranch: string;
  headBranch: string;
  parts: string;
  language: string;
}

// 兼容原 prompts.ts 的 langInstruction 解析逻辑
function langInstruction(language: string): string {
  return language === "English" ? "Please respond in English." : "请用中文回复。";
}

function renderDiffBlock(fileDiffs: { filePath: string; diff: string }[]): string {
  return fileDiffs
    .map((f) => `### 文件: ${f.filePath}\n\`\`\`diff\n${f.diff}\n\`\`\``)
    .join("\n\n");
}

function toReviewVars(input: ReviewChainInput): ReviewPromptVars {
  return {
    baseBranch: input.baseBranch,
    headBranch: input.headBranch,
    fileCount: String(input.fileDiffs.length),
    diffBlock: renderDiffBlock(input.fileDiffs),
    language: langInstruction(input.language),
  };
}

function toMergeVars(input: MergeChainInput): MergePromptVars {
  const parts = input.partialResults
    .map((r, i) => `### 第 ${i + 1} 部分\n\n${r}`)
    .join("\n\n---\n\n");
  return {
    baseBranch: input.baseBranch,
    headBranch: input.headBranch,
    parts,
    language: langInstruction(input.language),
  };
}

/**
 * LCEL 链：变量映射 → ChatPromptTemplate → model → StringOutputParser
 * 返回 string（模型文本内容）
 */
export function buildReviewChain(model: BaseChatModel) {
  return RunnableLambda.from<ReviewChainInput, ReviewPromptVars>(toReviewVars)
    .pipe(buildReviewPrompt())
    .pipe(model)
    .pipe(new StringOutputParser());
}

export function buildTechSpecChain(model: BaseChatModel) {
  return RunnableLambda.from<ReviewChainInput, ReviewPromptVars>(toReviewVars)
    .pipe(buildTechSpecPrompt())
    .pipe(model)
    .pipe(new StringOutputParser());
}

export function buildMergeChain(model: BaseChatModel) {
  return RunnableLambda.from<MergeChainInput, MergePromptVars>(toMergeVars)
    .pipe(buildMergePrompt())
    .pipe(model)
    .pipe(new StringOutputParser());
}

export function buildTechSpecMergeChain(model: BaseChatModel) {
  return RunnableLambda.from<MergeChainInput, MergePromptVars>(toMergeVars)
    .pipe(buildTechSpecMergePrompt())
    .pipe(model)
    .pipe(new StringOutputParser());
}

// 显式导出 FileDiff 类型别名，便于 pipeline 复用
export type { FileDiff };
