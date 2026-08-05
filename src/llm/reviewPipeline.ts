import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { DiffResult, FileDiff } from "../gitService";
import { DocumentType } from "../prompts";
import type { LLMConfig } from "../llmService";
import { chunkFiles } from "./chunker";
import {
  buildReviewChain,
  buildTechSpecChain,
  buildMergeChain,
  buildTechSpecMergeChain,
  ReviewChainInput,
  MergeChainInput,
} from "./chains";

/**
 * 大 diff 并发上限：RunnableParallel 无内置并发控制，
 * 直接全并发有触发 DeepSeek 429 的风险，故用 Promise 池限流。
 * 后续可提为配置项。
 */
const DEFAULT_CONCURRENCY = 3;

/**
 * 单 diff 生成 → 必要时分块并行 + 合并 的 LCEL 编排。
 *
 * @param callbacks 可选 LangChain 回调，用于未来可观测性（耗时/日志）。
 *                  进度上报仍通过 onProgress 直接回调，以保留原 UX 文案。
 */
export async function runReviewPipeline(
  diffResult: DiffResult,
  docType: DocumentType,
  model: BaseChatModel,
  config: LLMConfig,
  onProgress?: (msg: string) => void,
  callbacks?: BaseCallbackHandler[]
): Promise<string> {
  const { fileDiffs, baseBranch, headBranch } = diffResult;
  const { maxCharsPerChunk, language } = config;

  const isTechSpec = docType === "tech-spec";
  const actionLabel = isTechSpec ? "生成技术方案" : "分析";

  const perChunkChain = isTechSpec ? buildTechSpecChain(model) : buildReviewChain(model);
  const mergeChain = isTechSpec ? buildTechSpecMergeChain(model) : buildMergeChain(model);

  const invokeOptions = callbacks && callbacks.length > 0 ? { callbacks } : undefined;

  const buildInput = (fds: FileDiff[]): ReviewChainInput => ({
    baseBranch,
    headBranch,
    fileDiffs: fds,
    language,
  });

  const totalChars = fileDiffs.reduce((sum, f) => sum + f.diff.length, 0);

  // ── 小 diff：一次性发送 ──
  if (totalChars <= maxCharsPerChunk) {
    onProgress?.(`正在${actionLabel} (${(totalChars / 1000).toFixed(0)}K 字符)...`);
    const content = await perChunkChain.invoke(buildInput(fileDiffs), invokeOptions);
    if (!content?.trim()) throw new Error("LLM 返回空内容");
    return content;
  }

  // ── 大 diff：分块 + 并发池 + 合并 ──
  const chunks = chunkFiles(fileDiffs, maxCharsPerChunk);
  onProgress?.(
    `Diff 较大 (${(totalChars / 1000).toFixed(0)}K 字符)，分 ${chunks.length} 块${actionLabel}...`
  );

  const partialResults: string[] = new Array(chunks.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const i = nextIndex++;
      if (i >= chunks.length) return;

      const chunk = chunks[i];
      const chunkChars = chunk.reduce((s, f) => s + f.diff.length, 0);
      onProgress?.(
        `${actionLabel}分块 ${i + 1}/${chunks.length}（${chunk.length} 个文件, ${(chunkChars / 1000).toFixed(0)}K 字符）...`
      );

      const result = await perChunkChain.invoke(buildInput(chunk), invokeOptions);
      if (!result?.trim()) throw new Error("LLM 返回空内容");
      partialResults[i] = result;
    }
  };

  const workers = Array.from(
    { length: Math.min(DEFAULT_CONCURRENCY, chunks.length) },
    () => worker()
  );
  await Promise.all(workers);

  // 只有一个分块（单文件超长的情况）→ 直接返回
  if (partialResults.length === 1) {
    return partialResults[0];
  }

  // 合并多分块结果
  onProgress?.("正在合并各分块结果...");
  const mergeInput: MergeChainInput = {
    baseBranch,
    headBranch,
    partialResults,
    language,
  };
  const merged = await mergeChain.invoke(mergeInput, invokeOptions);
  if (!merged?.trim()) throw new Error("LLM 返回空内容");
  return merged;
}
