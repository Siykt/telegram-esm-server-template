// 双向链表, 用于实现插入 O(1), 删除 O(1)
class LinkedNode<K, V> {
  key: K;
  val: V;
  next: LinkedNode<K, V> | null;
  pre: LinkedNode<K, V> | null;

  constructor(key: K, val: V) {
    this.key = key;
    this.val = val;
    this.next = null;
    this.pre = null;
  }
}

// LRU缓存算法
export default class LRUCache<K extends string | number | bigint, V> {
  // 保存最新的数据
  private head: LinkedNode<K, V> | null = null;

  // 保存最早的数据也就是即将删除的数据
  private tail: LinkedNode<K, V> | null = null;

  // HashMap, 用于实现读取 O(1), 提升缓存项随机访问性能
  private hashmap = new Map<K, LinkedNode<K, V>>();
  private length = 0;

  constructor(
    // 缓存容量
    private capacity: number
  ) {
    if (capacity <= 0) throw TypeError('无效容量');
  }

  /**
   * 从缓存中获取key对应的值，若未命中则返回 null
   * @param key 键
   */
  get(key: K) {
    const entry = this.hashmap.get(key);
    if (entry) {
      this.exchangeToHead(entry);
      return entry.val;
    }
    return null;
  }

  /**
   * 向缓存中插入或更新值
   * @param key 键
   * @param value 值
   */
  put(key: K, value: V) {
    const isAdd = !this.has(key);
    const entry = this.hashmap.get(key) ?? new LinkedNode(key, value);

    entry.val = value;
    this.exchangeToHead(entry);
    this.hashmap.set(key, entry);

    if (!isAdd || !this.tail) return;

    // 移除多余长度的head
    if (this.length === this.capacity) {
      this.hashmap.delete(this.tail.key);
      if (this.tail.pre) {
        this.tail.pre.next = null;
        this.tail = this.tail.pre;
      }
    } else {
      this.length++;
    }
  }

  /**
   * @see this.put
   */
  set(key: K, value: V) {
    this.put(key, value);
    return this;
  }

  /**
   * 从缓存中删除key对应的值
   * @param key 键
   */
  del(key: K) {
    const entry = this.hashmap.get(key);
    if (!entry) return;
    this.hashmap.delete(key);
    if (entry.pre) {
      entry.pre.next = entry.next;
    }
    if (entry.next) {
      entry.next.pre = entry.pre;
    }
    if (entry === this.head) {
      this.head = entry.next;
    }
    if (entry === this.tail) {
      this.tail = entry.pre;
    }
  }

  /**
   * @see this.del
   */
  delete(key: K) {
    this.del(key);
    return true;
  }

  /**
   * 判断缓存中是否存在key
   * @param key 键
   */
  has(key: K) {
    return this.hashmap.has(key);
  }

  /**
   * 将结点移动至head
   * @param node 节点
   */
  private exchangeToHead(node: LinkedNode<K, V>) {
    if (node === this.head) return;
    if (!this.head) {
      this.head = node;
      this.tail = node;
      return;
    }
    // 移除node
    const { pre, next } = node;
    if (pre) pre.next = next;
    if (next) next.pre = pre;

    // 更新node至head
    node.pre = null;
    node.next = this.head;
    this.head.pre = node;
    this.head = node;

    // 更新tail
    if (node === this.tail && pre) {
      this.tail = pre;
    }
  }
}
