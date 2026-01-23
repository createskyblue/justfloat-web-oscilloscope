/**
 * 格式化数字，保留指定小数位
 */
export function formatNumber(value: number, decimals: number = 6): string {
  if (!isFinite(value)) return '-'
  return value.toFixed(decimals)
}

/**
 * 格式化大数字（带单位）
 */
export function formatLargeNumber(value: number): string {
  if (value >= 1000000) {
    return (value / 1000000).toFixed(2) + 'M'
  }
  if (value >= 1000) {
    return (value / 1000).toFixed(2) + 'K'
  }
  return value.toString()
}

/**
 * 格式化时间（毫秒）
 */
export function formatTime(ms: number): string {
  if (ms < 1) {
    return (ms * 1000).toFixed(0) + ' μs'
  }
  if (ms < 1000) {
    return ms.toFixed(1) + ' ms'
  }
  if (ms < 60000) {
    return ms.toFixed(2) + ' s'
  }
  // 大于1分钟，显示 分钟:秒 格式
  const minutes = Math.floor(ms / 60000)
  const seconds = (ms % 60000) / 1000
  return `${minutes}:${seconds.toFixed(0).padStart(2, '0')} min`
}

/**
 * 格式化频率
 */
export function formatFrequency(hz: number): string {
  if (hz >= 1000000) {
    return (hz / 1000000).toFixed(2) + ' MHz'
  }
  if (hz >= 1000) {
    return (hz / 1000).toFixed(2) + ' kHz'
  }
  return hz.toFixed(0) + ' Hz'
}

/**
 * 下载 JSON 文件
 */
export function downloadJson(data: object, filename: string) {
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * 读取 JSON 文件
 */
export function readJsonFile<T>(file: File): Promise<T> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string) as T
        resolve(data)
      } catch (error) {
        reject(new Error('无效的 JSON 文件'))
      }
    }
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsText(file)
  })
}

/**
 * 节流函数
 */
export function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let lastCall = 0
  return (...args: Parameters<T>) => {
    const now = Date.now()
    if (now - lastCall >= delay) {
      lastCall = now
      fn(...args)
    }
  }
}

/**
 * 防抖函数
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}
