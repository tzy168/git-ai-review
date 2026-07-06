import { RunnableLambda } from "@langchain/core/runnables";
import { FileDiff } from "../gitService";

/** 超长单文件截断时的尾部提示，保持与重构前逐位一致 */
const TRUNCATE_TAIL = "\n\n// ... [diff 已截断，内容过长] ...";

/**
 * 将文件按字符数分块，每块不超过 maxChars。
 * 超大文件单独截断成一块。逻辑源自原 LLMService.chunkFiles。
 */
export function chunkFiles(fileDiffs: FileDiff[], maxChars: number): FileDiff[][] {
  const chunks: FileDiff[][] = [];
  let current: FileDiff[] = [];
  let currentSize = 0;

  for (const fd of fileDiffs) {
    // 单个文件超限 → 截断后单独成块
    if (fd.diff.length > maxChars) {
      if (current.length > 0) {
        chunks.push(current);
        current = [];
        currentSize = 0;
      }
      chunks.push([
        {
          ...fd,
          diff: fd.diff.substring(0, maxChars) + TRUNCATE_TAIL,
        },
      ]);
      continue;
    }

    // 放入当前块会超限 → 当前块封存，开新块
    if (currentSize + fd.diff.length > maxChars && current.length > 0) {
      chunks.push(current);
      current = [];
      currentSize = 0;
    }

    current.push(fd);
    currentSize += fd.diff.length;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

/**
 * 自定义 Runnable：输入 { fileDiffs, maxChars }，输出 FileDiff[][]。
 * 用于在 LCEL pipeline 中以 .pipe 串联分块步骤。
 */
export const chunkDiffFiles = RunnableLambda.from(
  (input: { fileDiffs: FileDiff[]; maxChars: number }) =>
    chunkFiles(input.fileDiffs, input.maxChars)
);
