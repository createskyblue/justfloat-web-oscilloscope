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

  // FireWater 内部状态
  let firewaterBuffer = ''
  let firewaterFirstLineSkipped = false // 标记是否已跳过第一行（可能不完整）
  const textDecoder = new TextDecoder()

  let onFrameCallback: ((values: number[]) => void) | null = null

  // ==================== JustFloat 协议解析 ====================

  const checkSyncBytes = (): boolean => {
    if (justfloatBuffer.length < 4) return false
    const start = justfloatBuffer.length - 4
    return justfloatBuffer[start] === SYNC_BYTES[0] &&
           justfloatBuffer[start + 1] === SYNC_BYTES[1] &&
           justfloatBuffer[start + 2] === SYNC_BYTES[2] &&
           justfloatBuffer[start + 3] === SYNC_BYTES[3]
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
            const payloadLength = payloadEnd - payloadStart

            if (payloadLength > 0 && payloadLength % 4 === 0) {
              const payload = justfloatBuffer.slice(payloadStart, payloadEnd)
              const values = parseFloats(payload)

              if (values.length > 0) {
                channelCount.value = values.length
                frameCount.value++

                if (onFrameCallback) {
                  onFrameCallback(values)
                }
              }
            }

            justfloatBuffer = justfloatBuffer.slice(secondSyncIndex)
            firstSyncIndex = justfloatBuffer.length - 4
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

      // 跳过第一行（可能是不完整的数据）
      if (!firewaterFirstLineSkipped) {
        firewaterFirstLineSkipped = true
        continue
      }

      // 跳过空行
      if (!line) continue

      // 解析行数据
      const values = parseFireWaterLine(line)
      if (values && values.length > 0) {
        channelCount.value = values.length
        frameCount.value++

        if (onFrameCallback) {
          onFrameCallback(values)
        }
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

  const setProtocol = (protocol: ProtocolType) => {
    if (currentProtocol.value !== protocol) {
      currentProtocol.value = protocol
      reset()
    }
  }

  const reset = () => {
    // JustFloat 状态
    justfloatBuffer = []
    justfloatState = JustFloatState.LOOKING_FOR_FIRST_SYNC
    firstSyncIndex = -1
    // FireWater 状态
    firewaterBuffer = ''
    firewaterFirstLineSkipped = false
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
    setProtocol,
    reset,
    fullReset,
    setChannelCount
  }
}
