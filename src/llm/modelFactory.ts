import { ChatDeepSeek } from "@langchain/deepseek";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { LLMConfig } from "../llmService";

/**
 * 多 Provider 扩展点：所有链与 pipeline 只依赖 BaseChatModel，
 * 唯一具体类型出现在此工厂。未来切换 ChatAnthropic / ChatOllama
 * 只需改这里，调用方零改动。
 *
 * 当前实现：DeepSeek 兼容 OpenAI 协议，使用官方 @langchain/deepseek 集成
 * （优于 ChatOpenAI + 自定义 baseURL，能正确处理 reasoning_content 等）。
 *
 * 兼容历史配置：原代码使用 `${baseUrl}/v1`，此处保持一致，
 * 以便用户配置的自定义代理路径行为不变。
 *
 * DeepSeek V4 默认开启 thinking：reasoning 与正文共用 max_tokens，
 * 长 Review 提示极易把额度耗在 reasoning 上，导致 content 为空、
 * 抛出「LLM 返回空内容」。审查场景关闭 thinking，并给足输出额度。
 */
export function createChatModel(config: LLMConfig): BaseChatModel {
  return new ChatDeepSeek({
    apiKey: config.apiKey,
    model: config.model,
    temperature: 0.2,
    maxTokens: 16384,
    configuration: { baseURL: `${config.baseUrl}/v1` },
    modelKwargs: {
      thinking: { type: "disabled" },
    },
  });
}
