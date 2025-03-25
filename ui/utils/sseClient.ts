// 定义 SSE 事件数据结构
export interface SSEEvent {
  type: string;
  data: string; // data 始终以字符串形式返回，由调用者自行解析
}

/**
 * 发送 SSE 请求
 *
 * @param options 参数包含：
 *   - accessToken: 可选的访问令牌
 *   - payload: 请求体，必须符合你的格式：
 *       {
 *         type: "message",
 *         userId: string,
 *         message: { messageId: string, chatId: string, content: string },
 *         files: any[],
 *         focusMode: string,
 *         copilotEnabled: boolean,
 *         optimizationMode: string,
 *         history: any[]
 *       }
 *   - onEvent: 回调函数，处理每个 SSE 消息事件
 */
export async function sendSSERequest(options: {
  accessToken?: string | null;
  payload: {
    type: string;
    userId: string;
    message: {
      messageId: string;
      chatId: string;
      content: string;
    };
    files: any[];
    focusMode: string;
    copilotEnabled: boolean;
    optimizationMode: string;
    history: any[];
  };
  onEvent: (event: SSEEvent) => void;
}) {
  const { accessToken, payload, onEvent } = options;

  // 使用 /api/chat/sse 接口（根据后端配置可调整）
  const url = `${process.env.NEXT_PUBLIC_API_URL}/chat/sse`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: accessToken ? `Bearer ${accessToken}` : "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok || !response.body) {
    throw new Error("Network response error or empty body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      onEvent({ type: "done", data: "" });
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    // 按 "\r\n\r\n" 分割完整 SSE 消息
    const parts = buffer.split("\r\n\r\n");
    // 保留最后可能不完整的部分，待下次数据拼接
    buffer = parts.pop() || "";
    for (const part of parts) {
      const event = parseSSEEvent(part);
      if (event) {
        onEvent(event);
      }
    }
  }
}

/**
 * 解析 SSE 数据块
 * 每个数据块可能包含多行数据，本函数将提取 event 类型和 data 数据
 */
function parseSSEEvent(raw: string): SSEEvent | null {
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  let eventType = "message";
  let dataStr = "";
  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventType = line.substring("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataStr += line.substring("data:".length).trim();
    }
  }
  if (dataStr) {
    return { type: eventType, data: dataStr };
  }
  return null;
}
