import { ref, shallowRef } from 'vue'
import type { ConnectionStatus } from '@/types'

export interface ConnectResult {
  success: boolean
  isUserSelected: boolean
}

export function useSerial() {
  const status = ref<ConnectionStatus>('disconnected')
  const errorMessage = ref<string>('')
  const port = shallowRef<SerialPort | null>(null)
  const reader = shallowRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)

  // 存储上次成功连接的串口信息，用于自动重连
  const lastConnectedPortInfo = ref<{ usbVendorId?: number; usbProductId?: number } | null>(null)

  let onDataCallback: ((data: Uint8Array) => void) | null = null
  let isReading = false
  let readLoopPromise: Promise<void> | null = null

  // 检查浏览器是否支持 Web Serial API
  const isSupported = () => {
    return 'serial' in navigator
  }

  // 获取已授权的串口列表
  const getAuthorizedPorts = async (): Promise<SerialPort[]> => {
    if (!isSupported()) return []
    try {
      return await navigator.serial.getPorts()
    } catch {
      return []
    }
  }

  // 连接串口
  // forceSelect: 是否强制弹窗选择
  // autoConnect: 是否允许自动连接已授权的串口
  const connect = async (
    baudRate: number = 115200,
    forceSelect: boolean = false,
    autoConnect: boolean = false
  ): Promise<ConnectResult> => {
    if (!isSupported()) {
      status.value = 'error'
      errorMessage.value = '您的浏览器不支持 Web Serial API，请使用 Chrome 或 Edge 浏览器'
      return { success: false, isUserSelected: false }
    }

    // 如果已经连接，先断开
    if (status.value === 'connected' && port.value) {
      await disconnect()
    }

    let isUserSelected = false
    let selectedPort: SerialPort | null = null

    try {
      status.value = 'connecting'
      errorMessage.value = ''

      if (forceSelect) {
        // 强制选择：弹窗让用户选择
        selectedPort = await navigator.serial.requestPort()
        isUserSelected = true
      } else if (autoConnect && lastConnectedPortInfo.value) {
        // 尝试自动连接：查找已授权的串口中匹配的
        const authorizedPorts = await getAuthorizedPorts()

        // 尝试找到上次连接的串口
        selectedPort = authorizedPorts.find(p => {
          const info = p.getInfo()
          return info.usbVendorId === lastConnectedPortInfo.value?.usbVendorId &&
                 info.usbProductId === lastConnectedPortInfo.value?.usbProductId
        }) || null

        // 如果没有找到匹配的，尝试使用最后一个授权的串口
        if (!selectedPort && authorizedPorts.length > 0) {
          selectedPort = authorizedPorts[authorizedPorts.length - 1]
        }

        // 如果还是没有，弹窗选择
        if (!selectedPort) {
          selectedPort = await navigator.serial.requestPort()
          isUserSelected = true
        }
      } else {
        // 首次连接或不允许自动连接：弹窗选择
        selectedPort = await navigator.serial.requestPort()
        isUserSelected = true
      }

      if (!selectedPort) {
        throw new Error('未选择串口')
      }

      // 检查串口是否已打开，如果已打开先关闭
      if (selectedPort.readable || selectedPort.writable) {
        try {
          await selectedPort.close()
          // 等待资源释放
          await new Promise(resolve => setTimeout(resolve, 200))
        } catch {
          // 忽略关闭时的错误
        }
      }

      // 打开串口
      await selectedPort.open({
        baudRate,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        flowControl: 'none',
        bufferSize: 4096
      })

      // 保存端口引用
      port.value = selectedPort

      // 保存端口信息用于自动重连
      if (isUserSelected || !lastConnectedPortInfo.value) {
        lastConnectedPortInfo.value = selectedPort.getInfo()
      }

      status.value = 'connected'

      // 开始读取数据
      readLoopPromise = startReading()

      return { success: true, isUserSelected }
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
      return { success: false, isUserSelected }
    }
  }

  // 重置端口（用于强制重新选择）
  const resetPort = () => {
    port.value = null
    lastConnectedPortInfo.value = null
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
            new Promise(resolve => setTimeout(resolve, 500))
          ])
        } catch {
          // 忽略
        }
        readLoopPromise = null
      }

      // 关闭串口
      if (port.value) {
        try {
          if (port.value.readable || port.value.writable) {
            await port.value.close()
          }
        } catch (error) {
          console.warn('关闭串口时出错:', error)
        }
        // 断开连接时清空 port，但保留 lastConnectedPortInfo 用于自动重连
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

  // 获取上次连接的串口信息
  const getLastConnectedPortInfo = () => {
    return lastConnectedPortInfo.value
  }

  return {
    status,
    errorMessage,
    isSupported,
    connect,
    disconnect,
    onData,
    getPortInfo,
    getAuthorizedPorts,
    resetPort,
    getLastConnectedPortInfo
  }
}
