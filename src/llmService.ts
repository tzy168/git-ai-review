import * as vscode from "vscode";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { DiffResult } from "./gitService";
import { DocumentType } from "./prompts";
import { createChatModel } from "./llm/modelFactory";
import { runReviewPipeline } from "./llm/reviewPipeline";

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
    model: cfg.get<string>("model", "deepseek-v4-flash"),
    language: cfg.get<string>("language", "中文"),
    maxCharsPerChunk: cfg.get<number>("maxCharsPerChunk", 50000),
  };
}

export class LLMService {
  private config: LLMConfig;
  private model: BaseChatModel;

  constructor(config: LLMConfig) {
    this.config = config;
    // 模型实例由工厂创建，类型为 BaseChatModel，便于多 Provider 扩展
    this.model = createChatModel(config);
  }

  /**
   * 生成 Review 报告（兼容旧接口）
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
   * 实际编排委托给 runReviewPipeline（LCEL 链 + 并发分块 + 合并）
   */
  async generate(
    diffResult: DiffResult,
    docType: DocumentType = "review",
    onProgress?: (msg: string) => void
  ): Promise<string> {
    try {
      return await runReviewPipeline(
        diffResult,
        docType,
        this.model,
        this.config,
        onProgress
      );
    } catch (error: any) {
      // 区分 API 错误类型，错误文案与原版完全一致以保留用户排查体验
      if (error?.status === 401) {
        throw new Error("DeepSeek API Key 无效，请检查设置");
      }
      if (error?.status === 429) {
        throw new Error("DeepSeek API 请求频率超限，请稍后重试");
      }
      if (error?.code === "ECONNREFUSED" || error?.code === "ENOTFOUND") {
        throw new Error(`无法连接 DeepSeek API (${this.config.baseUrl})`);
      }
      // pipeline 抛出的空内容错误，原样透传
      if (error?.message === "LLM 返回空内容") {
        throw error;
      }
      throw new Error(`DeepSeek API 调用失败: ${error?.message ?? error}`);
    }
  }
}
