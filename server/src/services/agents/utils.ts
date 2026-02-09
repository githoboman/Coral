import { BaseMessage } from "@langchain/core/messages";

/**
 * Safely extracts string content from a LangChain message.
 * Handles both string content and complex content blocks (arrays of objects).
 */
export function extractMessageContent(message: BaseMessage | { content: any }): string {
  const content = message.content;

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block;
        if (block && typeof block === 'object' && 'text' in block) {
          return String(block.text);
        }
        return JSON.stringify(block);
      })
      .join('');
  }

  if (content === null || content === undefined) {
    return '';
  }

  return String(content);
}
