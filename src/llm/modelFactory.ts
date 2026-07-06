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
 */
export function createChatModel(config: LLMConfig): BaseChatModel {
  return new ChatDeepSeek({
    apiKey: config.apiKey,
    model: config.model,
    temperature: 0.2,
    maxTokens: 8192,
    configuration: { baseURL: `${config.baseUrl}/v1` },
  });
}
