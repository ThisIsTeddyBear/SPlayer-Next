/**
 * 流式读取并限制响应体大小，避免先完整分配不可信响应再检查上限。
 * @param response - 待读取的响应
 * @param maxBytes - 解压后的字节上限
 * @returns 完整响应字节
 */
export const readResponseBytes = async (
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> => {
  const declared = Number(response.headers.get("content-length"));
  if (declared > maxBytes) {
    await response.body?.cancel();
    throw new Error("Response exceeds size limit");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("Response exceeds size limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
};
