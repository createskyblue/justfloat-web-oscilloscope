import { ref } from 'vue'
import { SYNC_BYTES } from '@/types'
import type { ProtocolType } from '@/types'

// JustFloat 解析状态
enum JustFloatState {
  LOOKING_FOR_FIRST_SYNC,
  LOOKING_FOR_SECOND_SYNC,
}

export function useProtocolParser() {
  const channelCount = ref(0)
  const frameCount = ref(0)
  const currentProtocol = ref<ProtocolType>('justfloat')

  // JustFloat 内部状态
  let justfloatBuffer: number[] = []
  let justfloatState = JustFloatState.LOOKING_FOR_FIRST_SYNC
  let firstSyncIndex = -1
  let expectedChannelCount = 0 // 记录预期的通道数，用于检测异常

  // FireWater 内部状态
  let firewaterBuffer = ''
  let textDecoder = new TextDecoder()

  let onFrameCallback: ((values: number[]) => void) | null = null
  let onFramesBatchCallback: ((frames: number[][]) => void) | null = null

  // 动态批量机制：根据缓冲区使用量智能调整批量大小
  let TARGET_BATCH_INTERVAL_MS = 16  // 默认 16ms（约 60fps）
  let lastBatchTime = 0
  let IDLE_FLUSH_DELAY = 16  // 空闲刷新延迟
  let framesBatch: number[][] = []
  let idleFlushTimer: ReturnType<typeof setTimeout> | null = null

  // 缓冲区使用率（由外部设置）
  let bufferUsageRatio = 0

  // 动态调整批量策略（根据缓冲区使用量）
  const adjustBatchStrategy = () => {
    if (bufferUsageRatio > 0.8) {
      // 缓冲区使用超过80%，大幅降低刷新频率
      TARGET_BATCH_INTERVAL_MS = 100  // 10fps
      IDLE_FLUSH_DELAY = 100
    } else if (bufferUsageRatio > 0.5) {
      // 缓冲区使用超过50%，降低刷新频率
      TARGET_BATCH_INTERVAL_MS = 50  // 20fps
      IDLE_FLUSH_DELAY = 50
    } else if (bufferUsageRatio > 0.3) {
      // 缓冲区使用超过30%，适度降低刷新频率
      TARGET_BATCH_INTERVAL_MS = 33  // 30fps
      IDLE_FLUSH_DELAY = 33
    } else {
      // 缓冲区使用较少，保持高刷新率
      TARGET_BATCH_INTERVAL_MS = 16  // 60fps
      IDLE_FLUSH_DELAY = 16
    }
  }

  // 设置缓冲区使用率（供外部调用）
  const setBufferUsage = (usage: number) => {
    bufferUsageRatio = Math.max(0, Math.min(1, usage)) // 限制在 0-1 范围
    adjustBatchStrategy()
  }

  // ==================== 批量帧处理 ====================

  const flushBatch = () => {
    if (idleFlushTimer) {
      clearTimeout(idleFlushTimer)
      idleFlushTimer = null
    }
    if (framesBatch.length === 0) return

    const batch = framesBatch
    framesBatch = []
    lastBatchTime = performance.now()  // 更新最后发送时间

    if (onFramesBatchCallback) {
      onFramesBatchCallback(batch)
    } else if (onFrameCallback) {
      // 降级：逐帧回调
      for (const values of batch) {
        onFrameCallback(values)
      }
    }
  }

  const scheduleIdleFlush = () => {
    if (idleFlushTimer) {
      clearTimeout(idleFlushTimer)
    }
    idleFlushTimer = setTimeout(flushBatch, IDLE_FLUSH_DELAY)
  }

  const addFrameToBatch = (values: number[]) => {
    framesBatch.push(values)
    frameCount.value++

    // 只在通道数增加时更新（避免因误解析导致通道数突然减少）
    if (values.length > channelCount.value) {
      channelCount.value = values.length
    } else if (channelCount.value === 0) {
      channelCount.value = values.length
    }

    // 基于时间的批量刷新：根据动态调整的间隔发送
    const now = performance.now()
    if (now - lastBatchTime >= TARGET_BATCH_INTERVAL_MS) {
      flushBatch()
      lastBatchTime = now
    } else {
      scheduleIdleFlush()
    }
  }

  // ==================== JustFloat 协议解析 ====================

  // 检查同步字节（检查 buffer 末尾的 4 个字节）
  const checkSyncBytes = (): boolean => {
    if (justfloatBuffer.length < 4) return false
    const start = justfloatBuffer.length - 4
    return justfloatBuffer[start] === SYNC_BYTES[0] &&
           justfloatBuffer[start + 1] === SYNC_BYTES[1] &&
           justfloatBuffer[start + 2] === SYNC_BYTES[2] &&
           justfloatBuffer[start + 3] === SYNC_BYTES[3]
  }

  // 检查是否在有效位置（避免在数据中间误判同步字）
  // payload 长度应该是 4 的倍数，且应该合理（至少要有一些数据）
  const isValidPayload = (payloadStart: number, payloadEnd: number): boolean => {
    const payloadLength = payloadEnd - payloadStart

    // payload 必须是 4 的倍数（float32）
    if (payloadLength % 4 !== 0) return false

    // payload 不能为空
    if (payloadLength === 0) return false

    // 至少要有一个完整的浮点数
    if (payloadLength < 4) return false

    // payload 长度应该合理（不超过 64 个通道，即 256 字节）
    // 这可以根据实际需求调整，但不应过大以避免误判
    if (payloadLength > 256) return false

    return true
  }

  const parseFloats = (data: number[]): number[] => {
    const floats: number[] = []
    const dataView = new DataView(new ArrayBuffer(4))

    for (let i = 0; i < data.length; i += 4) {
      dataView.setUint8(0, data[i])
      dataView.setUint8(1, data[i + 1])
      dataView.setUint8(2, data[i + 2])
      dataView.setUint8(3, data[i + 3])
      floats.push(dataView.getFloat32(0, true))
    }

    return floats
  }

  // 快速查找同步字节位置（使用 Uint8Array 的 indexOf 批量搜索）
  const findSyncBytes = (data: Uint8Array, startIndex: number): number => {
    // 查找 0x00 0x00 0x80 0x7F 模式
    // 优化：先找 0x7F，然后回退检查前面三个字节
    for (let i = startIndex + 3; i < data.length; i++) {
      if (data[i] === SYNC_BYTES[3] &&
          data[i - 1] === SYNC_BYTES[2] &&
          data[i - 2] === SYNC_BYTES[1] &&
          data[i - 3] === SYNC_BYTES[0]) {
        return i - 3
      }
    }
    return -1
  }

  const processJustFloat = (data: Uint8Array) => {
    // 将新数据追加到 buffer（使用 Uint8Array 提高性能）
    const newBuffer = new Uint8Array(justfloatBuffer.length + data.length)
    newBuffer.set(justfloatBuffer)
    newBuffer.set(data, justfloatBuffer.length)
    justfloatBuffer = Array.from(newBuffer)

    // 限制 buffer 大小（避免内存溢出）
    if (justfloatBuffer.length > 50000) {
      // 保留最后一部分数据，但要对齐到4字节边界
      const excess = justfloatBuffer.length - 4096
      const alignedExcess = Math.floor(excess / 4) * 4
      justfloatBuffer = justfloatBuffer.slice(alignedExcess)
      justfloatState = JustFloatState.LOOKING_FOR_FIRST_SYNC
      firstSyncIndex = -1
    }

    // 批量处理：查找所有同步字节位置
    let searchStart = 0
    const syncPositions: number[] = []

    while (searchStart < justfloatBuffer.length - 3) {
      const pos = findSyncBytes(new Uint8Array(justfloatBuffer), searchStart)
      if (pos === -1) break
      syncPositions.push(pos)
      searchStart = pos + 4 // 跳到同步字之后继续搜索
    }

    // 如果没有找到同步字，直接返回
    if (syncPositions.length === 0) return

    // 处理帧（需要至少两个同步字才能确定一帧）
    let processedUpTo = 0
    for (let i = 0; i < syncPositions.length - 1; i++) {
      const firstSync = syncPositions[i]
      const secondSync = syncPositions[i + 1]
      const payloadStart = firstSync + 4
      const payloadEnd = secondSync

      if (!isValidPayload(payloadStart, payloadEnd)) continue

      const payload = justfloatBuffer.slice(payloadStart, payloadEnd)
      const values = parseFloats(payload)

      // 检查通道数一致性
      if (expectedChannelCount > 0 && values.length !== expectedChannelCount) {
        continue
      }

      if (values.length > 0) {
        if (expectedChannelCount === 0) {
          expectedChannelCount = values.length
        }
        addFrameToBatch(values)
      }

      processedUpTo = secondSync
    }

    // 保留未处理的数据（从最后一个完整的帧开始）
    if (processedUpTo > 0) {
      justfloatBuffer = justfloatBuffer.slice(processedUpTo)
    }
  }

  // ==================== FireWater 协议解析 ====================
  // 格式: "<any>:ch0,ch1,ch2,...,chN\n" 或 "ch0,ch1,...,chN\n"

  const processFireWater = (data: Uint8Array) => {
    // 将新数据追加到缓冲区
    firewaterBuffer += textDecoder.decode(data, { stream: true })

    // 防止缓冲区过大
    if (firewaterBuffer.length > 100000) {
      firewaterBuffer = firewaterBuffer.slice(-50000)
    }

    // 查找并处理完整的行
    let lineEnd: number
    while ((lineEnd = findLineEnd(firewaterBuffer)) !== -1) {
      const line = firewaterBuffer.substring(0, lineEnd).trim()
      firewaterBuffer = firewaterBuffer.substring(lineEnd + 1)

      // 跳过空行
      if (!line) continue

      // 解析行数据
      const values = parseFireWaterLine(line)
      if (values && values.length > 0) {
        addFrameToBatch(values)
      }
    }
  }

  // 查找行结束位置（支持 \n, \r\n, \n\r）
  const findLineEnd = (str: string): number => {
    for (let i = 0; i < str.length; i++) {
      if (str[i] === '\n' || str[i] === '\r') {
        // 跳过可能的 \r\n 或 \n\r 组合
        if (i + 1 < str.length && (str[i + 1] === '\n' || str[i + 1] === '\r') && str[i + 1] !== str[i]) {
          return i + 1
        }
        return i
      }
    }
    return -1
  }

  // 解析 FireWater 行格式
  const parseFireWaterLine = (line: string): number[] | null => {
    // 跳过 image 前缀
    if (line.toLowerCase().startsWith('image')) {
      return null
    }

    let dataStr = line

    // 如果有冒号，取冒号后面的部分
    const colonIndex = line.indexOf(':')
    if (colonIndex !== -1) {
      dataStr = line.substring(colonIndex + 1)
    }

    // 按逗号分割并解析数字
    const parts = dataStr.split(',')
    const values: number[] = []

    for (const part of parts) {
      const trimmed = part.trim()
      if (trimmed === '') continue

      const num = parseFloat(trimmed)
      if (isFinite(num)) {
        values.push(num)
      } else {
        // 如果解析失败，整行数据无效
        return null
      }
    }

    return values.length > 0 ? values : null
  }

  // ==================== 公共接口 ====================

  const processData = (data: Uint8Array) => {
    if (currentProtocol.value === 'justfloat') {
      processJustFloat(data)
    } else {
      processFireWater(data)
    }
  }

  const onFrame = (callback: (values: number[]) => void) => {
    onFrameCallback = callback
  }

  const onFramesBatch = (callback: (frames: number[][]) => void) => {
    onFramesBatchCallback = callback
  }

  const setProtocol = (protocol: ProtocolType) => {
    if (currentProtocol.value !== protocol) {
      currentProtocol.value = protocol
      reset()
    }
  }

  const reset = () => {
    // 清理批量缓存
    if (idleFlushTimer) {
      clearTimeout(idleFlushTimer)
      idleFlushTimer = null
    }
    framesBatch = []
    // JustFloat 状态
    justfloatBuffer = []
    justfloatState = JustFloatState.LOOKING_FOR_FIRST_SYNC
    firstSyncIndex = -1
    expectedChannelCount = 0 // 重置通道数记录
    // FireWater 状态
    firewaterBuffer = ''
    textDecoder = new TextDecoder() // 重新创建以清除内部状态
  }

  const fullReset = () => {
    reset()
    channelCount.value = 0
    frameCount.value = 0
  }

  const setChannelCount = (count: number) => {
    channelCount.value = count
  }

  return {
    channelCount,
    frameCount,
    currentProtocol,
    processData,
    onFrame,
    onFramesBatch,
    setProtocol,
    reset,
    fullReset,
    setChannelCount,
    setBufferUsage
  }
}
