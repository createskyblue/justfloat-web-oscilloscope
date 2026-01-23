import { ref, computed, shallowRef } from 'vue'
import type { DataFrame, ChannelStats } from '@/types'
import { MIN_BUFFER_SIZE, MAX_BUFFER_SIZE } from '@/types'

// 高性能环形缓冲区
class RingBuffer {
  private buffer: DataFrame[]
  private head: number = 0
  private tail: number = 0
  private _size: number = 0
  private capacity: number

  constructor(capacity: number) {
    this.capacity = capacity
    this.buffer = new Array(capacity)
  }

  push(frame: DataFrame) {
    this.buffer[this.tail] = frame
    this.tail = (this.tail + 1) % this.capacity
    if (this._size < this.capacity) {
      this._size++
    } else {
      this.head = (this.head + 1) % this.capacity
    }
  }

  pushBatch(frames: DataFrame[]) {
    for (const frame of frames) {
      this.push(frame)
    }
  }

  get size(): number {
    return this._size
  }

  get(index: number): DataFrame | undefined {
    if (index < 0 || index >= this._size) return undefined
    return this.buffer[(this.head + index) % this.capacity]
  }

  // 获取指定范围的数据（用于选区统计）
  getRange(start: number, end: number): DataFrame[] {
    const result: DataFrame[] = []
    const actualEnd = Math.min(end, this._size - 1)
    for (let i = start; i <= actualEnd; i++) {
      const frame = this.get(i)
      if (frame) result.push(frame)
    }
    return result
  }

  // 转换为数组（懒加载，仅在需要时调用）
  toArray(): DataFrame[] {
    const result = new Array(this._size)
    for (let i = 0; i < this._size; i++) {
      result[i] = this.buffer[(this.head + i) % this.capacity]
    }
    return result
  }

  clear() {
    this.head = 0
    this.tail = 0
    this._size = 0
  }

  resize(newCapacity: number) {
    if (newCapacity === this.capacity) return
    const data = this.toArray().slice(-newCapacity)
    this.capacity = newCapacity
    this.buffer = new Array(newCapacity)
    this.head = 0
    this.tail = 0
    this._size = 0
    for (const frame of data) {
      this.push(frame)
    }
  }
}

export function useDataBuffer(initialSize: number = 10000) {
  const bufferSize = ref(Math.max(MIN_BUFFER_SIZE, Math.min(MAX_BUFFER_SIZE, initialSize)))
  const ringBuffer = new RingBuffer(bufferSize.value)

  // 用于触发响应式更新的版本号
  const dataVersion = ref(0)
  const data = shallowRef<DataFrame[]>([])
  const sampleRate = ref(0)

  // 缓存的统计数据（每个通道独立缓存时间）
  let cachedStats: Map<number, { stats: ChannelStats; timestamp: number }> = new Map()
  const STATS_UPDATE_INTERVAL = 100 // 每100ms更新一次统计

  // 用于计算采样率的变量
  let sampleCount = 0
  let sampleRateUpdateTime = 0

  // 节流更新响应式数据
  let pendingUpdate = false
  const scheduleUpdate = () => {
    if (pendingUpdate) return
    pendingUpdate = true
    queueMicrotask(() => {
      dataVersion.value++
      pendingUpdate = false
    })
  }

  // 数据点总数
  const totalPoints = computed(() => {
    dataVersion.value // 依赖版本号触发更新
    return ringBuffer.size
  })

  // 添加数据帧
  const addFrame = (values: number[]) => {
    const now = performance.now()
    const frame: DataFrame = {
      timestamp: now,
      values
    }

    // 初始化更新时间（首次调用时）
    if (sampleRateUpdateTime === 0) {
      sampleRateUpdateTime = now
      sampleCount = 0  // 重置为 0，下面会 +1
    }

    // 计算采样率
    sampleCount++

    const elapsed = now - sampleRateUpdateTime
    if (elapsed >= 1000) {
      sampleRate.value = Math.round(sampleCount / (elapsed / 1000))
      sampleRateUpdateTime = now
      sampleCount = 0
    }

    ringBuffer.push(frame)
    scheduleUpdate()
  }

  // 批量添加数据帧
  const addFrames = (frames: number[][]) => {
    if (frames.length === 0) return

    const now = performance.now()
    const newFrames: DataFrame[] = frames.map((values, index) => ({
      timestamp: now + index * 0.1,
      values
    }))

    // 初始化更新时间（首次调用时）
    if (sampleRateUpdateTime === 0) {
      sampleRateUpdateTime = now
      sampleCount = 0  // 重置为 0，下面会添加帧数
    }

    // 计算采样率
    sampleCount += frames.length

    const elapsed = now - sampleRateUpdateTime
    if (elapsed >= 1000) {
      sampleRate.value = Math.round(sampleCount / (elapsed / 1000))
      sampleRateUpdateTime = now
      sampleCount = 0
    }

    ringBuffer.pushBatch(newFrames)

    scheduleUpdate()
  }

  // 计算通道统计数据（当前缓冲区窗口内的值，应用系数）
  const getChannelStats = (channelIndex: number, coefficient: number = 1): ChannelStats | null => {
    const now = performance.now()
    const totalSize = ringBuffer.size
    if (totalSize === 0) return null

    // 使用缓存，避免频繁计算（每个通道独立判断）
    const cached = cachedStats.get(channelIndex)
    if (cached && (now - cached.timestamp) < STATS_UPDATE_INTERVAL) {
      // 应用系数到缓存值
      return {
        min: cached.stats.min * coefficient,
        max: cached.stats.max * coefficient,
        avg: cached.stats.avg * coefficient,
        current: cached.stats.current * coefficient
      }
    }

    // 计算统计值（对大数据量使用采样）
    let min = Infinity
    let max = -Infinity
    let sum = 0
    let count = 0
    let current = 0

    // 对于大数据量，使用采样计算
    const sampleStep = totalSize > 50000 ? Math.ceil(totalSize / 10000) : 1

    for (let i = 0; i < totalSize; i += sampleStep) {
      const frame = ringBuffer.get(i)
      if (frame && channelIndex < frame.values.length) {
        const value = frame.values[channelIndex]
        if (isFinite(value)) {
          min = Math.min(min, value)
          max = Math.max(max, value)
          sum += value
          count++
        }
      }
    }

    // 获取当前值（最后一帧）
    const lastFrame = ringBuffer.get(totalSize - 1)
    if (lastFrame && channelIndex < lastFrame.values.length) {
      current = lastFrame.values[channelIndex]
    }

    if (count === 0) return null

    // 缓存原始值（不含系数）
    const rawStats: ChannelStats = {
      min: min,
      max: max,
      avg: sum / count,
      current: current
    }
    cachedStats.set(channelIndex, { stats: rawStats, timestamp: now })

    // 返回应用系数后的值
    return {
      min: rawStats.min * coefficient,
      max: rawStats.max * coefficient,
      avg: rawStats.avg * coefficient,
      current: rawStats.current * coefficient
    }
  }

  // 获取选区统计（仅在需要时计算选区数据，应用系数）
  const getSelectionStats = (startIndex: number, endIndex: number, channelCount: number, coefficients: number[] = []) => {
    const frames = ringBuffer.getRange(startIndex, endIndex)
    if (frames.length < 2) return null

    const duration = frames[frames.length - 1].timestamp - frames[0].timestamp
    const frequency = frames.length / (duration / 1000)

    const channels = []
    for (let ch = 0; ch < channelCount; ch++) {
      let min = Infinity
      let max = -Infinity
      let sum = 0
      let count = 0
      const coef = coefficients[ch] ?? 1

      for (const frame of frames) {
        if (ch < frame.values.length) {
          const value = frame.values[ch]
          if (isFinite(value)) {
            min = Math.min(min, value)
            max = Math.max(max, value)
            sum += value
            count++
          }
        }
      }

      channels.push({
        id: ch,
        min: (count > 0 ? min : 0) * coef,
        max: (count > 0 ? max : 0) * coef,
        avg: (count > 0 ? sum / count : 0) * coef
      })
    }

    return {
      startIndex,
      endIndex,
      pointCount: frames.length,
      duration,
      frequency,
      channels
    }
  }


  // 获取用于图表的数据（带智能降采样）
  const getChartData = (channelCount: number, coefficients: number[] = []) => {
    dataVersion.value // 依赖版本号
    const totalSize = ringBuffer.size
    if (totalSize === 0) return null

    // 根据数据量动态调整目标点数
    let targetPoints: number
    if (totalSize > 500000) {
      targetPoints = 5000
    } else if (totalSize > 200000) {
      targetPoints = 10000
    } else if (totalSize > 100000) {
      targetPoints = 20000
    } else if (totalSize > 50000) {
      targetPoints = 30000
    } else {
      targetPoints = totalSize // 不降采样
    }

    const needDownsample = totalSize > targetPoints
    const step = needDownsample ? Math.ceil(totalSize / targetPoints) : 1
    const outputSize = needDownsample ? Math.ceil(totalSize / step) : totalSize

    // 预分配 TypedArray
    const xData = new Float64Array(outputSize)
    const series: Float64Array[] = []
    for (let i = 0; i < channelCount; i++) {
      series.push(new Float64Array(outputSize))
    }

    if (needDownsample && totalSize > 100000) {
      // 对于大数据量，使用 min-max 降采样（保留峰值）
      let outIdx = 0
      for (let i = 0; i < totalSize && outIdx < outputSize; i += step) {
        const endIdx = Math.min(i + step, totalSize)

        // 找这个范围内每个通道的极值点
        let maxDiffIdx = i
        let maxDiff = 0

        for (let j = i; j < endIdx; j++) {
          const frame = ringBuffer.get(j)
          if (!frame) continue

          for (let ch = 0; ch < channelCount; ch++) {
            const val = ch < frame.values.length ? frame.values[ch] : 0
            const diff = Math.abs(val)
            if (diff > maxDiff) {
              maxDiff = diff
              maxDiffIdx = j
            }
          }
        }

        const frame = ringBuffer.get(maxDiffIdx)
        if (frame) {
          xData[outIdx] = maxDiffIdx
          for (let ch = 0; ch < channelCount; ch++) {
            const rawValue = ch < frame.values.length ? frame.values[ch] : 0
            const coef = coefficients[ch] ?? 1
            series[ch][outIdx] = rawValue * coef
          }
          outIdx++
        }
      }

      // 如果实际输出少于预期，调整数组大小
      if (outIdx < outputSize) {
        return [xData.slice(0, outIdx), ...series.map(s => s.slice(0, outIdx))]
      }
    } else {
      // 普通采样或全量数据
      let outIdx = 0
      for (let i = 0; i < totalSize && outIdx < outputSize; i += step) {
        const frame = ringBuffer.get(i)
        if (!frame) continue

        xData[outIdx] = i
        for (let ch = 0; ch < channelCount; ch++) {
          const rawValue = ch < frame.values.length ? frame.values[ch] : 0
          const coef = coefficients[ch] ?? 1
          series[ch][outIdx] = rawValue * coef
        }
        outIdx++
      }
    }

    return [xData, ...series]
  }

  // 获取指定范围的数据（用于框选缩放后的详细显示）
  const getChartDataInRange = (
    startIndex: number,
    endIndex: number,
    channelCount: number,
    coefficients: number[] = []
  ) => {
    const rangeSize = endIndex - startIndex + 1
    if (rangeSize <= 0) return null

    // 对于选区也应用降采样
    const targetPoints = Math.min(rangeSize, 50000)
    const step = rangeSize > targetPoints ? Math.ceil(rangeSize / targetPoints) : 1
    const outputSize = Math.ceil(rangeSize / step)

    const xData = new Float64Array(outputSize)
    const series: Float64Array[] = []
    for (let i = 0; i < channelCount; i++) {
      series.push(new Float64Array(outputSize))
    }

    let outIdx = 0
    for (let i = startIndex; i <= endIndex && outIdx < outputSize; i += step) {
      const frame = ringBuffer.get(i)
      if (!frame) continue

      xData[outIdx] = i
      for (let ch = 0; ch < channelCount; ch++) {
        const rawValue = ch < frame.values.length ? frame.values[ch] : 0
        const coef = coefficients[ch] ?? 1
        series[ch][outIdx] = rawValue * coef
      }
      outIdx++
    }

    return [xData.slice(0, outIdx), ...series.map(s => s.slice(0, outIdx))]
  }

  // 清空数据
  const clear = () => {
    ringBuffer.clear()
    cachedStats.clear()
    data.value = []
    dataVersion.value++
    sampleRate.value = 0
    sampleCount = 0
    sampleRateUpdateTime = 0
  }

  // 设置缓冲区大小
  const setBufferSize = (size: number) => {
    const newSize = Math.max(MIN_BUFFER_SIZE, Math.min(MAX_BUFFER_SIZE, size))
    bufferSize.value = newSize
    ringBuffer.resize(newSize)
    dataVersion.value++
  }

  // 导入数据
  const importData = (frames: DataFrame[]) => {
    clear()
    const toImport = frames.slice(-bufferSize.value)
    for (const frame of toImport) {
      ringBuffer.push(frame)
    }
    dataVersion.value++
  }

  // 导出数据
  const exportData = (): DataFrame[] => {
    return ringBuffer.toArray()
  }

  // 获取数据大小
  const getDataSize = () => ringBuffer.size

  return {
    bufferSize,
    data,
    dataVersion,
    sampleRate,
    totalPoints,
    addFrame,
    addFrames,
    getChannelStats,
    getSelectionStats,
    getChartData,
    getChartDataInRange,
    getDataSize,
    clear,
    setBufferSize,
    importData,
    exportData
  }
}
