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

  // 动态批量机制：基于时间而非固定帧数
  // 目标：以约 30fps 的频率发送批量（约 33ms 一批），保证图表流畅
  // 无论采样率是多少，都维持 30fps 的刷新
  const TARGET_BATCH_INTERVAL_MS = 33  // 每 33ms 发送一批（约 30fps）
  let lastBatchTime = 0
  const IDLE_FLUSH_DELAY = 33  // 空闲33ms后刷新（约30fps）
  let framesBatch: number[][] = []
  let idleFlushTimer: ReturnType<typeof setTimeout> | null = null

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

    // 基于时间的批量刷新：每 16ms 发送一批（约 60fps）
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

  const processJustFloat = (data: Uint8Array) => {
    for (let i = 0; i < data.length; i++) {
      justfloatBuffer.push(data[i])

      if (justfloatBuffer.length > 100000) {
        justfloatBuffer = justfloatBuffer.slice(-50000)
        justfloatState = JustFloatState.LOOKING_FOR_FIRST_SYNC
        firstSyncIndex = -1
      }

      switch (justfloatState) {
        case JustFloatState.LOOKING_FOR_FIRST_SYNC:
          if (checkSyncBytes()) {
            firstSyncIndex = justfloatBuffer.length - 4
            justfloatState = JustFloatState.LOOKING_FOR_SECOND_SYNC
          }
          break

        case JustFloatState.LOOKING_FOR_SECOND_SYNC:
          if (checkSyncBytes()) {
            const secondSyncIndex = justfloatBuffer.length - 4
            const payloadStart = firstSyncIndex + 4
            const payloadEnd = secondSyncIndex

            // 使用新的验证逻辑，避免在数据中间误判同步字
            if (isValidPayload(payloadStart, payloadEnd)) {
              const payload = justfloatBuffer.slice(payloadStart, payloadEnd)
              const values = parseFloats(payload)

              // 检查通道数是否一致（如果已经知道通道数）
              if (expectedChannelCount > 0 && values.length !== expectedChannelCount) {
                // 通道数不一致，可能是误判的同步字，跳过这次处理
                // 重置状态，重新查找
                justfloatState = JustFloatState.LOOKING_FOR_FIRST_SYNC
                firstSyncIndex = -1
                break  // 使用 break 而不是 return，继续处理后续字节
              }

              // 只添加有效的数据帧（至少包含一个通道的数据）
              if (values.length > 0) {
                // 记录通道数（第一次成功解析时）
                if (expectedChannelCount === 0) {
                  expectedChannelCount = values.length
                }
                addFrameToBatch(values)
              }
            } else {
              // payload 无效，可能是误判的同步字，继续查找
              // 不要截断 buffer，继续处理
              break
            }

            // 修复：正确处理 buffer 截断，确保 firstSyncIndex 指向正确的同步字位置
            // 保留第二个同步字，使其成为下一次查找的第一个同步字
            justfloatBuffer = justfloatBuffer.slice(secondSyncIndex)
            firstSyncIndex = 0 // 现在第二个同步字已经在 buffer 的开头了
          }
          break
      }
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
    setChannelCount
  }
}
