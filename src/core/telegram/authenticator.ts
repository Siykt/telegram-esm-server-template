import CryptoJS from 'crypto-js'

export class TGAuthenticator {
  constructor(readonly token: string) {}

  private hmacSHA256Hex(message: string, key: CryptoJS.lib.WordArray) {
    return CryptoJS.HmacSHA256(message, key).toString(CryptoJS.enc.Hex)
  }

  /**
   * 校验TG小程序初始化数据是否合法
   * @param initData Telegram 初始化数据
   */
  verifyMiniApp(initData: string) {
    // 获取传入数据
    const params = new URLSearchParams(initData)
    const hash = params.get('hash')
    if (!hash)
      return false

    // 生成需要校验的数据
    // 排序, 从 a-z, 并且排除 hash
    params.delete('hash')
    params.sort()

    // 计算 hash
    const dataCheck = this.hmacSHA256Hex(
      // 合并数据, 生成字符串
      Array.from(params).reduce((acc, [key, val]) => `${acc}${key}=${val}\n`, ''),
      // 通过 HmacSHA256 的方式生成 secret
      CryptoJS.HmacSHA256(this.token, 'WebAppData'),
    )
    return dataCheck === hash
  }

  /**
   * 校验 OAuth 数据是否合法
   * @param data OAuth 数据
   * @param data.hash 用于验证的哈希值
   */
  verifyOAuth(data: { hash?: string, [x: string]: unknown }) {
    const { hash, ...others } = data
    if (!hash)
      return false

    // 计算 hash
    const dataCheck = this.hmacSHA256Hex(
      // 排列数据并合并数据, 生成字符串
      Object.entries(others)
        .sort(([key1], [key2]) => key1.localeCompare(key2))
        .reduce((acc, [key, val]) => `${acc}${key}=${val}\n`, ''),
      // 通过 HmacSHA256 的方式生成 secret
      CryptoJS.SHA256(this.token),
    )
    return dataCheck === hash
  }
}
