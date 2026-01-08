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

// 增量统计计算器（避免每次遍历所有数据）
class IncrementalStats {
  private channelStats: Map<number, { min: number; max: number; sum: number; count: number; current: number }> = new Map()

  update(channelIndex: number, value: number) {
    let stats = this.channelStats.get(channelIndex)
    if (!stats) {
      stats = { min: Infinity, max: -Infinity, sum: 0, count: 0, current: 0 }
      this.channelStats.set(channelIndex, stats)
    }
    if (isFinite(value)) {
      stats.min = Math.min(stats.min, value)
      stats.max = Math.max(stats.max, value)
      stats.sum += value
      stats.count++
      stats.current = value
    }
  }

  get(channelIndex: number): ChannelStats | null {
    const stats = this.channelStats.get(channelIndex)
    if (!stats || stats.count === 0) return null
    return {
      min: stats.min,
      max: stats.max,
      avg: stats.sum / stats.count,
      current: stats.current
    }
  }

  clear() {
    this.channelStats.clear()
  }
}

export function useDataBuffer(initialSize: number = 10000) {
  const bufferSize = ref(Math.max(MIN_BUFFER_SIZE, Math.min(MAX_BUFFER_SIZE, initialSize)))
  const ringBuffer = new RingBuffer(bufferSize.value)
  const incrementalStats = new IncrementalStats()

  // 用于触发响应式更新的版本号
  const dataVersion = ref(0)
  const data = shallowRef<DataFrame[]>([])
  const sampleRate = ref(0)

  // 用于计算采样率的变量
  let lastTimestamp = 0
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

    // 计算采样率（每秒更新一次）
    sampleCount++
    if (now - sampleRateUpdateTime >= 1000) {
      if (lastTimestamp > 0) {
        sampleRate.value = Math.round(sampleCount / ((now - sampleRateUpdateTime) / 1000))
      }
      sampleRateUpdateTime = now
      sampleCount = 0
    }
    lastTimestamp = now

    ringBuffer.push(frame)

    // 更新增量统计
    for (let i = 0; i < values.length; i++) {
      incrementalStats.update(i, values[i])
    }

    scheduleUpdate()
  }

  // 批量添加数据帧
  const addFrames = (frames: number[][]) => {
    const now = performance.now()
    const newFrames: DataFrame[] = frames.map((values, index) => ({
      timestamp: now + index * 0.1,
      values
    }))

    // 计算采样率
    sampleCount += frames.length
    if (now - sampleRateUpdateTime >= 1000) {
      if (lastTimestamp > 0) {
        sampleRate.value = Math.round(sampleCount / ((now - sampleRateUpdateTime) / 1000))
      }
      sampleRateUpdateTime = now
      sampleCount = 0
    }
    lastTimestamp = now

    ringBuffer.pushBatch(newFrames)

    // 更新增量统计
    for (const frame of newFrames) {
      for (let i = 0; i < frame.values.length; i++) {
        incrementalStats.update(i, frame.values[i])
      }
    }

    scheduleUpdate()
  }

  // 计算通道统计数据（使用增量统计，O(1)复杂度）
  const getChannelStats = (channelIndex: number): ChannelStats | null => {
    return incrementalStats.get(channelIndex)
  }

  // 获取选区统计（仅在需要时计算选区数据）
  const getSelectionStats = (startIndex: number, endIndex: number, channelCount: number) => {
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
        min: count > 0 ? min : 0,
        max: count > 0 ? max : 0,
        avg: count > 0 ? sum / count : 0
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

  // LTTB 降采样算法（保持波形特征）
  const downsampleLTTB = (data: number[], threshold: number): number[] => {
    if (data.length <= threshold) return data

    const result: number[] = []
    const bucketSize = (data.length - 2) / (threshold - 2)

    result.push(data[0]) // 保留第一个点

    let a = 0 // 上一个选中的点
    for (let i = 0; i < threshold - 2; i++) {
      // 计算当前桶的范围
      const bucketStart = Math.floor((i + 1) * bucketSize) + 1
      const bucketEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, data.length - 1)

      // 计算下一个桶的平均值
      const nextBucketStart = Math.floor((i + 2) * bucketSize) + 1
      const nextBucketEnd = Math.min(Math.floor((i + 3) * bucketSize) + 1, data.length - 1)
      let avgX = 0, avgY = 0, count = 0
      for (let j = nextBucketStart; j < nextBucketEnd && j < data.length; j++) {
        avgX += j
        avgY += data[j]
        count++
      }
      if (count > 0) {
        avgX /= count
        avgY /= count
      }

      // 在当前桶中找到与上一个点和平均点形成最大三角形面积的点
      let maxArea = -1
      let maxAreaIndex = bucketStart
      const pointAX = a
      const pointAY = data[a]

      for (let j = bucketStart; j < bucketEnd && j < data.length; j++) {
        const area = Math.abs((pointAX - avgX) * (data[j] - pointAY) - (pointAX - j) * (avgY - pointAY))
        if (area > maxArea) {
          maxArea = area
          maxAreaIndex = j
        }
      }

      result.push(data[maxAreaIndex])
      a = maxAreaIndex
    }

    result.push(data[data.length - 1]) // 保留最后一个点
    return result
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
    incrementalStats.clear()
    data.value = []
    dataVersion.value++
    sampleRate.value = 0
    lastTimestamp = 0
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
      for (let i = 0; i < frame.values.length; i++) {
        incrementalStats.update(i, frame.values[i])
      }
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
