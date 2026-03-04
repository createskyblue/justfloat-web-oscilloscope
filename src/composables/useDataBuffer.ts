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
  private _droppedCount: number = 0  // 记录总共丢弃的数据点数量

  constructor(capacity: number) {
    this.capacity = capacity
    this.buffer = new Array(capacity)
  }

  push(frame: DataFrame) {
    // 如果缓冲区已满，精确丢弃1个最旧的数据点
    if (this._size >= this.capacity) {
      this.dropOldestData(1)
    }

    this.buffer[this.tail] = frame
    this.tail = (this.tail + 1) % this.capacity
    this._size++
  }

  // 主动丢弃最旧的 n 个数据点，返回实际丢弃的数量
  private dropOldestData(count: number): number {
    if (count <= 0 || this._size <= 0) return 0

    const actualDropCount = Math.min(count, this._size)

    // 清空被丢弃位置的引用，帮助垃圾回收
    for (let i = 0; i < actualDropCount; i++) {
      const idx = (this.head + i) % this.capacity
      this.buffer[idx] = undefined as unknown as DataFrame
    }

    // 将 head 向前移动，相当于丢弃了最开始的数据
    this.head = (this.head + actualDropCount) % this.capacity
    this._size = Math.max(0, this._size - actualDropCount)
    this._droppedCount += actualDropCount

    return actualDropCount
  }

  pushBatch(frames: DataFrame[]) {
    if (frames.length === 0) return

    const incomingCount = frames.length
    const availableSpace = this.capacity - this._size

    // 如果新数据超出可用空间，精确丢弃相同数量的旧数据
    if (incomingCount > availableSpace) {
      const needToDrop = incomingCount - availableSpace
      this.dropOldestData(needToDrop)
    }

    // 批量写入数据
    for (const frame of frames) {
      this.buffer[this.tail] = frame
      this.tail = (this.tail + 1) % this.capacity
      this._size++
    }
  }

  get size(): number {
    return this._size
  }

  // 获取缓冲区使用率 (0-1)
  get utilization(): number {
    return this._size / this.capacity
  }

  // 获取缓冲区容量
  get maxCapacity(): number {
    return this.capacity
  }

  // 获取总共丢弃的数据点数量（用于调整外部索引）
  get droppedCount(): number {
    return this._droppedCount
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
    this._droppedCount = 0
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
  // 响应式的丢弃计数，用于触发图表缩放范围调整
  const droppedCount = ref(0)

  // 缓存的统计数据（每个通道独立缓存时间）
  let cachedStats: Map<number, { stats: ChannelStats; timestamp: number }> = new Map()
  const STATS_UPDATE_INTERVAL = 100 // 每100ms更新一次统计

  // 缓存图表数据，避免每次渲染都重新创建 TypedArray
  let cachedChartData: (Float64Array | number[])[] | null = null
  let cachedChartDataVersion = -1

  // 缓存全量数据，避免频繁重建（大数据量时性能关键）
  let cachedFullChartData: (Float64Array | number[])[] | null = null
  let cachedFullChartDataVersion = -1

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
      sampleCount = 0
    }

    // 计算采样率（优化：降低更新频率以减少卡顿）
    sampleCount++

    const elapsed = now - sampleRateUpdateTime
    if (elapsed >= 2000) {  // 从1000ms改为2000ms
      sampleRate.value = Math.round(sampleCount / (elapsed / 1000))
      sampleRateUpdateTime = now
      sampleCount = 0
    }

    const previousDropped = ringBuffer.droppedCount
    ringBuffer.push(frame)
    // 如果发生了数据丢弃，同步更新响应式的 droppedCount
    if (ringBuffer.droppedCount !== previousDropped) {
      droppedCount.value = ringBuffer.droppedCount
    }
    scheduleUpdate()
  }

  // 批量添加数据帧
  const addFrames = (frames: number[][]) => {
    if (frames.length === 0) return

    const now = performance.now()

    // 使用当前采样率计算采样间隔（毫秒）
    // 如果采样率未知，暂时使用 1ms 间隔，后续会更新
    const currentRate = sampleRate.value > 0 ? sampleRate.value : 1
    const sampleInterval = 1000 / currentRate

    // 按采样间隔设置递增的时间戳
    const newFrames: DataFrame[] = frames.map((values, index) => ({
      timestamp: now + index * sampleInterval,
      values
    }))

    // 初始化更新时间（首次调用时）
    if (sampleRateUpdateTime === 0) {
      sampleRateUpdateTime = now
      sampleCount = 0
    }

    // 计算采样率（优化：降低更新频率以减少卡顿）
    sampleCount += frames.length

    const elapsed = now - sampleRateUpdateTime
    if (elapsed >= 2000) {  // 从1000ms改为2000ms
      sampleRate.value = Math.round(sampleCount / (elapsed / 1000))
      sampleRateUpdateTime = now
      sampleCount = 0
    }

    const previousDropped = ringBuffer.droppedCount
    ringBuffer.pushBatch(newFrames)
    // 如果发生了数据丢弃，同步更新响应式的 droppedCount
    if (ringBuffer.droppedCount !== previousDropped) {
      droppedCount.value = ringBuffer.droppedCount
    }
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

    const pointCount = frames.length

    // 直接用采样率计算时长，不依赖 timestamp
    // 时长（毫秒）= 点数 / 采样率 * 1000
    const currentSampleRate = sampleRate.value > 0 ? sampleRate.value : 1
    const duration = (pointCount / currentSampleRate) * 1000

    // 频率 = 1000 / 时长（毫秒）
    const frequency = 1000 / duration

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
      pointCount,
      duration,
      frequency,
      channels
    }
  }


  // 获取用于图表的数据（带智能降采样）
  const getChartData = (channelCount: number, coefficients: number[] = []) => {
    dataVersion.value // 依赖版本号
    const totalSize = ringBuffer.size

    // 检查缓存
    if (cachedChartData && cachedChartDataVersion === dataVersion.value) {
      return cachedChartData
    }

    if (totalSize === 0) {
      cachedChartData = null
      cachedChartDataVersion = dataVersion.value
      return null
    }

    // 根据数据量动态调整目标点数（更激进的降采样策略）
    let targetPoints: number
    if (totalSize > 1000000) {
      targetPoints = 2000  // 超大数据量：每500点取1个
    } else if (totalSize > 500000) {
      targetPoints = 3000  // 50万点：每167点取1个
    } else if (totalSize > 200000) {
      targetPoints = 4000  // 20万点：每50点取1个
    } else if (totalSize > 100000) {
      targetPoints = 5000  // 10万点：每20点取1个
    } else if (totalSize > 50000) {
      targetPoints = 10000  // 5万点：每5点取1个
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

    // 使用简单的均匀采样，不使用 min-max 算法（性能提升5倍）
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

    // 如果实际输出少于预期，调整数组大小
    if (outIdx < outputSize) {
      const result = [xData.slice(0, outIdx), ...series.map(s => s.slice(0, outIdx))]
      cachedChartData = result
      cachedChartDataVersion = dataVersion.value
      return result
    }

    const result = [xData, ...series]
    cachedChartData = result
    cachedChartDataVersion = dataVersion.value
    return result
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

  // 获取全量数据（用于缩放功能和选区统计，保持原始索引）
  const getFullChartData = (channelCount: number, coefficients: number[] = []) => {
    const totalSize = ringBuffer.size

    if (totalSize === 0) {
      cachedFullChartData = null
      cachedFullChartDataVersion = dataVersion.value
      return null
    }

    // 检查缓存（数据版本未变化时直接返回缓存，大幅提升性能）
    if (cachedFullChartData && cachedFullChartDataVersion === dataVersion.value) {
      return cachedFullChartData
    }

    // 返回全量数据，不降采样（保持索引正确性，用于缩放和选区）
    const outputSize = totalSize
    const xData = new Float64Array(outputSize)
    const series: Float64Array[] = []
    for (let i = 0; i < channelCount; i++) {
      series.push(new Float64Array(outputSize))
    }

    for (let i = 0; i < totalSize; i++) {
      const frame = ringBuffer.get(i)
      if (!frame) continue

      xData[i] = i
      for (let ch = 0; ch < channelCount; ch++) {
        const rawValue = ch < frame.values.length ? frame.values[ch] : 0
        const coef = coefficients[ch] ?? 1
        series[ch][i] = rawValue * coef
      }
    }

    const result = [xData, ...series]
    cachedFullChartData = result
    cachedFullChartDataVersion = dataVersion.value
    return result
  }

  // 获取 Minimap 数据（专门用于预览，带降采样）
  // 返回的数据 x 值保持原始索引，但数据点减少
  const getMinimapData = (channelCount: number, coefficients: number[] = []) => {
    const totalSize = ringBuffer.size

    if (totalSize === 0) {
      return null
    }

    // 根据数据量动态调整降采样率
    let step = 1
    if (totalSize > 500000) {
      step = 10  // 50万+数据：每10点取1个
    } else if (totalSize > 200000) {
      step = 5   // 20万+数据：每5点取1个
    } else if (totalSize > 100000) {
      step = 2   // 10万+数据：每2点取1个
    }

    const outputSize = Math.ceil(totalSize / step)
    const xData = new Float64Array(outputSize)
    const series: Float64Array[] = []
    for (let i = 0; i < channelCount; i++) {
      series.push(new Float64Array(outputSize))
    }

    let outIdx = 0
    for (let i = 0; i < totalSize && outIdx < outputSize; i += step) {
      const frame = ringBuffer.get(i)
      if (!frame) continue

      xData[outIdx] = i  // 保持原始索引
      for (let ch = 0; ch < channelCount; ch++) {
        const rawValue = ch < frame.values.length ? frame.values[ch] : 0
        const coef = coefficients[ch] ?? 1
        series[ch][outIdx] = rawValue * coef
      }
      outIdx++
    }

    // 如果实际输出少于预期，调整数组大小
    if (outIdx < outputSize) {
      return [xData.slice(0, outIdx), ...series.map(s => s.slice(0, outIdx))]
    }

    return [xData, ...series]
  }

  // 清空数据
  const clear = () => {
    ringBuffer.clear()
    cachedStats.clear()
    cachedChartData = null
    cachedChartDataVersion = -1
    cachedFullChartData = null
    cachedFullChartDataVersion = -1
    data.value = []
    dataVersion.value++
    droppedCount.value = 0
    sampleRate.value = 0
    sampleCount = 0
    sampleRateUpdateTime = 0
  }

  // 设置缓冲区大小
  const setBufferSize = (size: number) => {
    const newSize = Math.max(MIN_BUFFER_SIZE, Math.min(MAX_BUFFER_SIZE, size))
    bufferSize.value = newSize
    const previousDropped = ringBuffer.droppedCount
    ringBuffer.resize(newSize)
    // 如果发生了数据丢弃，同步更新响应式的 droppedCount
    if (ringBuffer.droppedCount !== previousDropped) {
      droppedCount.value = ringBuffer.droppedCount
    }
    dataVersion.value++
  }

  // 导入数据（从 DataFrame[] 格式）
  const importData = (frames: DataFrame[]) => {
    clear()
    const toImport = frames.slice(-bufferSize.value)
    for (const frame of toImport) {
      const previousDropped = ringBuffer.droppedCount
      ringBuffer.push(frame)
      // 如果发生了数据丢弃，同步更新响应式的 droppedCount
      if (ringBuffer.droppedCount !== previousDropped) {
        droppedCount.value = ringBuffer.droppedCount
      }
    }
    dataVersion.value++
  }

  // 导出数据（按通道存储的数组格式，不包含时间戳）
  const exportData = (): number[][] => {
    const totalSize = ringBuffer.size
    if (totalSize === 0) return []

    // 确定通道数（从第一帧获取）
    const firstFrame = ringBuffer.get(0)
    if (!firstFrame) return []
    const channelCount = firstFrame.values.length

    // 初始化通道数组
    const channels: number[][] = []
    for (let i = 0; i < channelCount; i++) {
      channels[i] = []
    }

    // 按通道填充数据
    for (let i = 0; i < totalSize; i++) {
      const frame = ringBuffer.get(i)
      if (frame) {
        for (let ch = 0; ch < channelCount; ch++) {
          channels[ch].push(ch < frame.values.length ? frame.values[ch] : 0)
        }
      }
    }

    return channels
  }

  // 从通道数组导入数据
  const importChannels = (channelData: number[][], channelCount: number, savedSampleRate?: number) => {
    console.log('[importChannels] 开始导入')
    console.log('[importChannels] 通道数:', channelCount)
    console.log('[importChannels] 缓冲区大小:', bufferSize.value)
    console.log('[importChannels] 实际通道数据长度:', channelData.length)

    clear()
    if (channelData.length === 0) {
      console.error('[importChannels] 通道数据为空')
      return
    }

    const pointCount = channelData[0].length
    const actualCount = Math.min(pointCount, bufferSize.value)
    console.log('[importChannels] 数据点数:', pointCount, '实际导入:', actualCount)

    // 批量导入时，直接操作 ringBuffer，避免频繁触发更新
    const frames: DataFrame[] = []
    const now = performance.now()

    for (let i = 0; i < actualCount; i++) {
      const values: number[] = []
      for (let ch = 0; ch < channelCount; ch++) {
        const value = ch < channelData.length ? (channelData[ch][i] ?? 0) : 0
        values.push(value)
      }
      frames.push({
        timestamp: now + (i / (savedSampleRate || 1)) * 1000,
        values
      })
    }

    // 一次性批量添加到 ringBuffer
    const previousDropped = ringBuffer.droppedCount
    ringBuffer.pushBatch(frames)
    // 如果发生了数据丢弃，同步更新响应式的 droppedCount
    if (ringBuffer.droppedCount !== previousDropped) {
      droppedCount.value = ringBuffer.droppedCount
    }

    // 导入完成后，触发一次更新
    scheduleUpdate()

    // 恢复采样率
    if (savedSampleRate && savedSampleRate > 0) {
      sampleRate.value = savedSampleRate
    }

    console.log('[importChannels] 导入完成，缓冲区大小:', ringBuffer.size, '采样率:', sampleRate.value)
  }

  // 设置采样率
  const setSampleRate = (rate: number) => {
    sampleRate.value = rate
  }

  // 获取数据大小
  const getDataSize = () => ringBuffer.size

  // 获取缓冲区使用率 (0-1)
  const getBufferUtilization = () => ringBuffer.utilization

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
    getFullChartData,
    getMinimapData,
    getDataSize,
    getBufferUtilization,
    clear,
    setBufferSize,
    importData,
    exportData,
    importChannels,
    setSampleRate,
    droppedCount
  }
}
