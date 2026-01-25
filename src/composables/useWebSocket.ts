import { ref } from 'vue'
import type { ConnectionStatus } from '@/types'

export function useWebSocket() {
  const status = ref<ConnectionStatus>('disconnected')
  const errorMessage = ref<string>('')

  let ws: WebSocket | null = null
  let onDataCallback: ((data: Uint8Array) => void) | null = null

  // WebSocket 始终支持
  const isSupported = () => true

  // 检查 WebSocket URL 协议是否与当前页面协议匹配
  const checkProtocolCompatibility = (wsUrl: string): { compatible: boolean; reason?: string } => {
    // 获取当前页面协议
    const pageProtocol = window.location.protocol // 'https:' 或 'http:'
    const isHttpsPage = pageProtocol === 'https:'

    // 从 WebSocket URL 中提取协议
    const urlProtocol = wsUrl.toLowerCase().startsWith('wss:') ? 'wss:' : 'ws:'
    const isWssUrl = urlProtocol === 'wss:'

    // 检查兼容性
    if (isHttpsPage && !isWssUrl) {
      return {
        compatible: false,
        reason: `当前页面使用 HTTPS 协议，但您尝试连接的是 WS（非加密）协议。\n\n由于浏览器的安全策略（混合内容限制），HTTPS 页面无法连接到非加密的 WebSocket 服务器。\n\n解决方案：\n1. 将 WebSocket 服务器升级为 WSS（加密）协议\n2. 或者使用 HTTP 协议访问本页面`
      }
    }

    // 如果是 HTTP 页面，两种协议都可以使用
    return { compatible: true }
  }

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
    checkProtocolCompatibility,
    connect,
    disconnect,
    onData,
    send
  }
}