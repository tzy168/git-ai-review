import OpenAI from "openai";
import * as vscode from "vscode";
import { DiffResult, FileDiff } from "./gitService";
import {
  buildReviewPrompt,
  buildMergePrompt,
  buildTechSpecPrompt,
  buildTechSpecMergePrompt,
  DocumentType,
} from "./prompts";

export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  language: string;
  maxCharsPerChunk: number;
}

export function getLLMConfig(): LLMConfig {
  const cfg = vscode.workspace.getConfiguration("git-ai-review");
  return {
    apiKey: cfg.get<string>("deepseekApiKey", ""),
    baseUrl: cfg.get<string>("deepseekBaseUrl", "https://api.deepseek.com"),
    model: cfg.get<string>("model", "deepseek-chat"),
    language: cfg.get<string>("language", "中文"),
    maxCharsPerChunk: cfg.get<number>("maxCharsPerChunk", 50000),
  };
}

export class LLMService {
  private client: OpenAI;
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: `${config.baseUrl}/v1`,
    });
  }

  /**
   * 生成 Review 报告
   * 自动处理大 diff 的分块策略
   */
  async generateReview(
    diffResult: DiffResult,
    onProgress?: (msg: string) => void
  ): Promise<string> {
    return this.generate(diffResult, "review", onProgress);
  }

  /**
   * 统一生成入口
   * 支持 review / tech-spec 两种文档类型
   */
  async generate(
    diffResult: DiffResult,
    docType: DocumentType = "review",
    onProgress?: (msg: string) => void
  ): Promise<string> {
    const { fileDiffs, baseBranch, headBranch } = diffResult;
    const { maxCharsPerChunk, language } = this.config;

    const isTechSpec = docType === "tech-spec";
    const actionLabel = isTechSpec ? "生成技术方案" : "分析";

    // 计算总 diff 字符数
    const totalChars = fileDiffs.reduce((sum, f) => sum + f.diff.length, 0);

    // ── 小 diff：一次性发送 ──
    if (totalChars <= maxCharsPerChunk) {
      onProgress?.(`正在${actionLabel} (${(totalChars / 1000).toFixed(0)}K 字符)...`);
      const prompt = isTechSpec
        ? buildTechSpecPrompt(baseBranch, headBranch, fileDiffs, language)
        : buildReviewPrompt(baseBranch, headBranch, fileDiffs, language);
      return this.callLLM(prompt, isTechSpec);
    }

    // ── 大 diff：分块处理 ──
    const chunks = this.chunkFiles(fileDiffs, maxCharsPerChunk);
    onProgress?.(
      `Diff 较大 (${(totalChars / 1000).toFixed(0)}K 字符)，分 ${chunks.length} 块${actionLabel}...`
    );

    const partialResults: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkChars = chunk.reduce((s, f) => s + f.diff.length, 0);
      onProgress?.(
        `${actionLabel}分块 ${i + 1}/${chunks.length}（${chunk.length} 个文件, ${(chunkChars / 1000).toFixed(0)}K 字符）...`
      );

      const prompt = isTechSpec
        ? buildTechSpecPrompt(baseBranch, headBranch, chunk, language)
        : buildReviewPrompt(baseBranch, headBranch, chunk, language);
      const result = await this.callLLM(prompt, isTechSpec);
      partialResults.push(result);
    }

    // 只有一个分块（单文件超长的情况）
    if (partialResults.length === 1) {
      return partialResults[0];
    }

    // 合并多分块结果
    onProgress?.("正在合并各分块结果...");
    const mergePrompt = isTechSpec
      ? buildTechSpecMergePrompt(baseBranch, headBranch, partialResults, language)
      : buildMergePrompt(baseBranch, headBranch, partialResults, language);
    return this.callLLM(mergePrompt, isTechSpec);
  }

  /**
   * 将文件按大小分组，每组不超过 maxChars
   * 超大文件单独截断
   */
  private chunkFiles(
    fileDiffs: FileDiff[],
    maxChars: number
  ): FileDiff[][] {
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
            diff:
              fd.diff.substring(0, maxChars) +
              "\n\n// ... [diff 已截断，内容过长] ...",
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
   * 调用 DeepSeek API
   */
  private async callLLM(prompt: string, isTechSpec: boolean = false): Promise<string> {
    try {
      const systemContent = isTechSpec
        ? "你是一位资深软件架构师和技术文档专家。你擅长从代码变更中反向推导技术方案，梳理需求背景、架构设计、接口定义、数据模型和实现细节。"
        : "你是一位资深代码审查专家。你擅长发现潜在 Bug、安全漏洞、性能问题，并给出具体、可操作的改进建议。";

      const response = await this.client.chat.completions.create({
        model: this.config.model,
        messages: [
          {
            role: "system",
            content: systemContent,
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 8192,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("LLM 返回空内容");
      }

      return content;
    } catch (error: any) {
      // 区分 API 错误类型
      if (error.status === 401) {
        throw new Error("DeepSeek API Key 无效，请检查设置");
      }
      if (error.status === 429) {
        throw new Error("DeepSeek API 请求频率超限，请稍后重试");
      }
      if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
        throw new Error(`无法连接 DeepSeek API (${this.config.baseUrl})`);
      }
      throw new Error(`DeepSeek API 调用失败: ${error.message}`);
    }
  }
}
