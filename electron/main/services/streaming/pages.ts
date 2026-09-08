/**
 * 逐页同步，不把服务端的单页上限误认为目录末尾。
 * @param fetchPage - 按偏移量获取一页
 * @param identify - 获取稳定的服务端 ID
 * @param cancelled - 检查任务是否失效
 * @param firstLimit - 首次请求大小
 */
export async function* streamPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<T[]>,
  identify: (item: T) => string | undefined,
  cancelled: () => boolean,
  firstLimit = 500,
): AsyncGenerator<T[]> {
  const seen = new Set<string>();
  let offset = 0;
  while (!cancelled()) {
    const page = await fetchPage(offset, offset === 0 ? firstLimit : 500);
    if (cancelled() || page.length === 0) return;
    for (const item of page) {
      const id = identify(item);
      if (!id || seen.has(id)) throw new Error("Media server returned missing or repeated IDs");
      seen.add(id);
    }
    yield page;
    offset += page.length;
  }
}
