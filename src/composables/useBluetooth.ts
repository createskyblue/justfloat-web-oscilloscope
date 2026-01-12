import { ref } from 'vue'
import type { ConnectionStatus } from '@/types'

export interface BluetoothConfig {
  serviceUUID: string
  characteristicUUID: string
}

export function useBluetooth() {
  const status = ref<ConnectionStatus>('disconnected')
  const errorMessage = ref<string>('')

  let device: BluetoothDevice | null = null
  let characteristic: BluetoothRemoteGATTCharacteristic | null = null
  let onDataCallback: ((data: Uint8Array) => void) | null = null

  // 检查浏览器是否支持 Web Bluetooth API
  const isSupported = () => {
    return 'bluetooth' in navigator
  }

  // 连接蓝牙设备
  const connect = async (config: BluetoothConfig) => {
    if (!isSupported()) {
      status.value = 'error'
      errorMessage.value = '您的浏览器不支持 Web Bluetooth API，请使用 Chrome 或 Edge 浏览器'
      return false
    }

    // 如果已经连接，先断开
    if (device) {
      await disconnect()
    }

    try {
      status.value = 'connecting'
      errorMessage.value = ''

      // 验证 UUID 格式
      const serviceUUID = normalizeUUID(config.serviceUUID)
      const characteristicUUID = normalizeUUID(config.characteristicUUID)

      if (!serviceUUID || !characteristicUUID) {
        throw new Error('无效的 UUID 格式')
      }

      // 请求蓝牙设备
      device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [serviceUUID] }],
        optionalServices: [serviceUUID]
      })

      if (!device.gatt) {
        throw new Error('设备不支持 GATT')
      }

      // 监听断开连接事件
      device.addEventListener('gattserverdisconnected', handleDisconnect)

      // 连接 GATT 服务器
      const server = await device.gatt.connect()

      // 获取服务
      const service = await server.getPrimaryService(serviceUUID)

      // 获取特征
      characteristic = await service.getCharacteristic(characteristicUUID)

      // 启动通知
      await characteristic.startNotifications()

      // 监听数据
      characteristic.addEventListener('characteristicvaluechanged', handleCharacteristicValueChanged)

      status.value = 'connected'
      return true
    } catch (error) {
      status.value = 'error'
      if (error instanceof Error) {
        if (error.name === 'NotFoundError') {
          errorMessage.value = '未选择蓝牙设备或设备不支持指定的服务'
        } else if (error.name === 'SecurityError') {
          errorMessage.value = '蓝牙权限被拒绝'
        } else if (error.name === 'NetworkError') {
          errorMessage.value = '蓝牙连接失败，请确保设备在范围内'
        } else {
          errorMessage.value = error.message
        }
      } else {
        errorMessage.value = '连接失败'
      }
      device = null
      characteristic = null
      return false
    }
  }

  // 处理特征值变化
  const handleCharacteristicValueChanged = (event: Event) => {
    const target = event.target as BluetoothRemoteGATTCharacteristic
    if (target.value && onDataCallback) {
      onDataCallback(new Uint8Array(target.value.buffer))
    }
  }

  // 处理断开连接
  const handleDisconnect = () => {
    if (status.value === 'connected') {
      status.value = 'disconnected'
      errorMessage.value = '蓝牙连接已断开'
    }
    cleanup()
  }

  // 清理资源
  const cleanup = () => {
    if (characteristic) {
      try {
        characteristic.removeEventListener('characteristicvaluechanged', handleCharacteristicValueChanged)
      } catch {
        // 忽略
      }
      characteristic = null
    }
    if (device) {
      try {
        device.removeEventListener('gattserverdisconnected', handleDisconnect)
      } catch {
        // 忽略
      }
      device = null
    }
  }

  // 断开连接
  const disconnect = async () => {
    try {
      if (characteristic) {
        try {
          await characteristic.stopNotifications()
        } catch {
          // 忽略
        }
      }
      if (device?.gatt?.connected) {
        device.gatt.disconnect()
      }
    } catch (error) {
      console.warn('断开蓝牙连接时出错:', error)
    }

    cleanup()
    status.value = 'disconnected'
    errorMessage.value = ''
  }

  // 注册数据回调
  const onData = (callback: (data: Uint8Array) => void) => {
    onDataCallback = callback
  }

  // 获取设备信息
  const getDeviceInfo = () => {
    if (!device) return null
    return {
      name: device.name || '未知设备',
      id: device.id
    }
  }

  return {
    status,
    errorMessage,
    isSupported,
    connect,
    disconnect,
    onData,
    getDeviceInfo
  }
}

// 规范化 UUID（支持 16 位和 128 位 UUID）
function normalizeUUID(uuid: string): string | null {
  if (!uuid) return null

  uuid = uuid.trim().toLowerCase()

  // 16 位 UUID (如 "ffe0" 或 "0xffe0")
  if (/^(0x)?[0-9a-f]{4}$/i.test(uuid)) {
    const shortUUID = uuid.replace(/^0x/, '')
    return `0000${shortUUID}-0000-1000-8000-00805f9b34fb`
  }

  // 完整的 128 位 UUID
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
    return uuid
  }

  // 无连字符的 128 位 UUID
  if (/^[0-9a-f]{32}$/i.test(uuid)) {
    return `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`
  }

  return null
}
