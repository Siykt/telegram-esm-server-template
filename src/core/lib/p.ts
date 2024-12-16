export async function pMapPool<T extends readonly unknown[] | [], X>(
  iterable: T,
  mapper: (item: T[number], index: number) => Promise<X>,
  options?: { concurrency?: number }
): Promise<{ [Index in keyof T]: Awaited<X> }>

export async function pMapPool<K, V, X>(
  iterable: Iterable<[K, V]>,
  mapper: (item: [K, V], index: number) => Promise<X>,
  options?: { concurrency?: number }
): Promise<X[]>

export async function pMapPool<T, X>(
  iterable: Iterable<T | PromiseLike<T>>,
  mapper: (item: T, index: number) => Promise<X>,
  { concurrency = Infinity } = {},
): Promise<Awaited<X>[]> {
  const results: Awaited<X>[] = []
  const iterator = iterable[Symbol.iterator]()

  let completed = false
  let start = 0

  const runBatch = async () => {
    const items: T[] = []

    for (let i = 0; i < concurrency; i += 1) {
      const iterableResult = iterator.next()

      if (iterableResult.done) {
        completed = true
        break
      }

      items.push(await iterableResult.value)
    }

    const batchResults = await Promise.all(items.map((item, i) => mapper(item, start + i)))
    start += items.length

    results.push(...batchResults)

    if (!completed)
      await runBatch()
  }

  await runBatch()

  return results
}
