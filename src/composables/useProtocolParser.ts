import { ref } from 'vue'
import { SYNC_BYTES } from '@/types'

// 解析状态
enum ParseState {
  LOOKING_FOR_FIRST_SYNC,  // 寻找第一个同步字
  LOOKING_FOR_SECOND_SYNC, // 寻找第二个同步字
}

export function useProtocolParser() {
  const channelCount = ref(0)
  const frameCount = ref(0)

  // 内部状态
  let buffer: number[] = []
  let state = ParseState.LOOKING_FOR_FIRST_SYNC
  let firstSyncIndex = -1

  let onFrameCallback: ((values: number[]) => void) | null = null

  // 检查缓冲区末尾是否匹配同步字
  const checkSyncBytes = (): boolean => {
    if (buffer.length < 4) return false
    const start = buffer.length - 4
    return buffer[start] === SYNC_BYTES[0] &&
           buffer[start + 1] === SYNC_BYTES[1] &&
           buffer[start + 2] === SYNC_BYTES[2] &&
           buffer[start + 3] === SYNC_BYTES[3]
  }

  // 解析 float 数组（Little Endian）
  const parseFloats = (data: number[]): number[] => {
    const floats: number[] = []
    const dataView = new DataView(new ArrayBuffer(4))

    for (let i = 0; i < data.length; i += 4) {
      dataView.setUint8(0, data[i])
      dataView.setUint8(1, data[i + 1])
      dataView.setUint8(2, data[i + 2])
      dataView.setUint8(3, data[i + 3])
      floats.push(dataView.getFloat32(0, true)) // true = little endian
    }

    return floats
  }

  // 处理接收到的数据
  const processData = (data: Uint8Array) => {
    for (let i = 0; i < data.length; i++) {
      buffer.push(data[i])

      // 防止缓冲区过大
      if (buffer.length > 100000) {
        buffer = buffer.slice(-50000)
        state = ParseState.LOOKING_FOR_FIRST_SYNC
        firstSyncIndex = -1
      }

      switch (state) {
        case ParseState.LOOKING_FOR_FIRST_SYNC:
          if (checkSyncBytes()) {
            firstSyncIndex = buffer.length - 4
            state = ParseState.LOOKING_FOR_SECOND_SYNC
          }
          break

        case ParseState.LOOKING_FOR_SECOND_SYNC:
          if (checkSyncBytes()) {
            const secondSyncIndex = buffer.length - 4
            const payloadStart = firstSyncIndex + 4
            const payloadEnd = secondSyncIndex
            const payloadLength = payloadEnd - payloadStart

            // 验证数据长度是否为4的倍数
            if (payloadLength > 0 && payloadLength % 4 === 0) {
              const payload = buffer.slice(payloadStart, payloadEnd)
              const values = parseFloats(payload)

              // 更新通道数
              if (values.length > 0) {
                channelCount.value = values.length
                frameCount.value++

                if (onFrameCallback) {
                  onFrameCallback(values)
                }
              }
            }

            // 移动指针到第二个同步字位置，继续解析
            buffer = buffer.slice(secondSyncIndex)
            firstSyncIndex = buffer.length - 4
            // 保持在 LOOKING_FOR_SECOND_SYNC 状态
          }
          break
      }
    }
  }

  // 注册帧回调
  const onFrame = (callback: (values: number[]) => void) => {
    onFrameCallback = callback
  }

  // 重置解析器状态（保留通道数配置）
  const reset = () => {
    buffer = []
    state = ParseState.LOOKING_FOR_FIRST_SYNC
    firstSyncIndex = -1
    // 注意：不重置 channelCount 和 frameCount，以保持UI一致性
    // 如果需要完全重置，使用 fullReset
  }

  // 完全重置（包括通道数和帧计数）
  const fullReset = () => {
    buffer = []
    state = ParseState.LOOKING_FOR_FIRST_SYNC
    firstSyncIndex = -1
    channelCount.value = 0
    frameCount.value = 0
  }

  return {
    channelCount,
    frameCount,
    processData,
    onFrame,
    reset,
    fullReset
  }
}
