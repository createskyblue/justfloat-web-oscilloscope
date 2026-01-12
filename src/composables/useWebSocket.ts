import { ref } from 'vue'
import type { ConnectionStatus } from '@/types'

export function useWebSocket() {
  const status = ref<ConnectionStatus>('disconnected')
  const errorMessage = ref<string>('')

  let ws: WebSocket | null = null
  let onDataCallback: ((data: Uint8Array) => void) | null = null

  // WebSocket 始终支持
  const isSupported = () => true

  // 连接 WebSocket
  const connect = async (url: string) => {
    // 如果已经连接，先断开
    if (ws) {
      await disconnect()
    }

    return new Promise<boolean>((resolve) => {
      try {
        status.value = 'connecting'
        errorMessage.value = ''

        ws = new WebSocket(url)
        ws.binaryType = 'arraybuffer'

        ws.onopen = () => {
          status.value = 'connected'
          resolve(true)
        }

        ws.onmessage = (event) => {
          if (onDataCallback) {
            if (event.data instanceof ArrayBuffer) {
              onDataCallback(new Uint8Array(event.data))
            } else if (typeof event.data === 'string') {
              // 文本数据转换为 Uint8Array
              const encoder = new TextEncoder()
              onDataCallback(encoder.encode(event.data))
            }
          }
        }

        ws.onerror = () => {
          status.value = 'error'
          errorMessage.value = 'WebSocket 连接错误'
          resolve(false)
        }

        ws.onclose = (event) => {
          if (status.value === 'connected') {
            status.value = 'disconnected'
            errorMessage.value = event.wasClean ? '' : '连接意外断开'
          }
          ws = null
        }
      } catch (error) {
        status.value = 'error'
        errorMessage.value = error instanceof Error ? error.message : '连接失败'
        ws = null
        resolve(false)
      }
    })
  }

  // 断开连接
  const disconnect = async () => {
    if (ws) {
      try {
        ws.close(1000, 'User disconnect')
      } catch {
        // 忽略关闭时的错误
      }
      ws = null
    }
    status.value = 'disconnected'
    errorMessage.value = ''
  }

  // 注册数据回调
  const onData = (callback: (data: Uint8Array) => void) => {
    onDataCallback = callback
  }

  // 发送数据
  const send = (data: string | ArrayBuffer | Uint8Array) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data)
      return true
    }
    return false
  }

  return {
    status,
    errorMessage,
    isSupported,
    connect,
    disconnect,
    onData,
    send
  }
}