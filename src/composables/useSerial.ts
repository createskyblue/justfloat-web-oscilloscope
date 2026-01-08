import { ref, shallowRef } from 'vue'
import type { ConnectionStatus } from '@/types'

export function useSerial() {
  const status = ref<ConnectionStatus>('disconnected')
  const errorMessage = ref<string>('')
  const port = shallowRef<SerialPort | null>(null)
  const reader = shallowRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)

  let onDataCallback: ((data: Uint8Array) => void) | null = null
  let isReading = false
  let readLoopPromise: Promise<void> | null = null

  // 检查浏览器是否支持 Web Serial API
  const isSupported = () => {
    return 'serial' in navigator
  }

  // 连接串口
  const connect = async (baudRate: number = 115200) => {
    if (!isSupported()) {
      status.value = 'error'
      errorMessage.value = '您的浏览器不支持 Web Serial API，请使用 Chrome 或 Edge 浏览器'
      return false
    }

    // 如果已经连接，先断开
    if (port.value) {
      await disconnect()
    }

    try {
      status.value = 'connecting'
      errorMessage.value = ''

      // 请求串口权限
      port.value = await navigator.serial.requestPort()

      // 打开串口
      await port.value.open({
        baudRate,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        flowControl: 'none',
        bufferSize: 4096
      })

      status.value = 'connected'

      // 开始读取数据
      readLoopPromise = startReading()

      return true
    } catch (error) {
      status.value = 'error'
      if (error instanceof Error) {
        if (error.name === 'NotFoundError') {
          errorMessage.value = '未选择串口设备'
        } else if (error.name === 'InvalidStateError') {
          errorMessage.value = '串口已被占用，请先关闭其他使用该串口的程序'
        } else {
          errorMessage.value = error.message
        }
      } else {
        errorMessage.value = '连接失败'
      }
      port.value = null
      return false
    }
  }

  // 开始读取数据
  const startReading = async () => {
    if (!port.value?.readable || isReading) return

    isReading = true

    try {
      while (isReading && port.value?.readable) {
        reader.value = port.value.readable.getReader()

        try {
          while (isReading) {
            const { value, done } = await reader.value.read()
            if (done) break
            if (value && onDataCallback) {
              onDataCallback(value)
            }
          }
        } finally {
          reader.value.releaseLock()
          reader.value = null
        }
      }
    } catch (error) {
      if (isReading) {
        console.error('读取数据出错:', error)
        status.value = 'error'
        errorMessage.value = error instanceof Error ? error.message : '读取数据失败'
      }
    }

    isReading = false
  }

  // 断开连接
  const disconnect = async () => {
    isReading = false

    try {
      // 先取消读取器
      if (reader.value) {
        try {
          await reader.value.cancel()
        } catch {
          // 忽略取消时的错误
        }
        try {
          reader.value.releaseLock()
        } catch {
          // 可能已经释放
        }
        reader.value = null
      }

      // 等待读取循环结束
      if (readLoopPromise) {
        try {
          await Promise.race([
            readLoopPromise,
            new Promise(resolve => setTimeout(resolve, 500)) // 超时500ms
          ])
        } catch {
          // 忽略
        }
        readLoopPromise = null
      }

      // 关闭串口
      if (port.value) {
        try {
          await port.value.close()
        } catch (error) {
          console.warn('关闭串口时出错:', error)
        }
        port.value = null
      }
    } catch (error) {
      console.error('断开连接时出错:', error)
    }

    status.value = 'disconnected'
    errorMessage.value = ''
  }

  // 注册数据回调
  const onData = (callback: (data: Uint8Array) => void) => {
    onDataCallback = callback
  }

  // 获取串口信息
  const getPortInfo = () => {
    if (!port.value) return null
    return port.value.getInfo()
  }

  return {
    status,
    errorMessage,
    isSupported,
    connect,
    disconnect,
    onData,
    getPortInfo
  }
}
