// 连接状态
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

// 连接类型
export type ConnectionType = 'serial' | 'websocket'

// 连接类型选项
export const CONNECTION_TYPE_OPTIONS = [
  { value: 'serial' as ConnectionType, label: '串口', description: 'Web Serial API' },
  { value: 'websocket' as ConnectionType, label: 'WebSocket', description: 'WebSocket 连接' }
] as const

// 协议类型
export type ProtocolType = 'justfloat' | 'firewater'

// 协议配置
export const PROTOCOL_OPTIONS = [
  { value: 'justfloat' as ProtocolType, label: 'JustFloat', description: '二进制同步字协议' },
  { value: 'firewater' as ProtocolType, label: 'FireWater', description: '文本行协议 (ch0,ch1,...\\n)' }
] as const

// 通道颜色预设
export const CHANNEL_COLORS = [
  '#2196F3', // 蓝色
  '#4CAF50', // 绿色
  '#FF9800', // 橙色
  '#E91E63', // 粉色
  '#9C27B0', // 紫色
  '#00BCD4', // 青色
  '#FFEB3B', // 黄色
  '#795548', // 棕色
] as const

// 通道配置
export interface ChannelConfig {
  id: number
  name: string
  unit: string
  coefficient: number
  visible: boolean
  color: string
}

// 通道统计数据
export interface ChannelStats {
  min: number
  max: number
  avg: number
  current: number
}

// 应用配置
export interface AppConfig {
  baudRate: number
  bufferSize: number
  channels: ChannelConfig[]
  protocol: ProtocolType
  connectionType: ConnectionType
  wsUrl: string
}

// 数据帧
export interface DataFrame {
  timestamp: number
  values: number[]
}

// 导出数据格式
export interface ExportData {
  config: AppConfig
  data: DataFrame[]
  sampleRate: number
  exportTime: string
}

// 选区统计
export interface SelectionStats {
  startIndex: number
  endIndex: number
  pointCount: number
  duration: number
  frequency: number
  channels: {
    id: number
    min: number
    max: number
    avg: number
  }[]
}

// 默认配置
export const DEFAULT_CONFIG: AppConfig = {
  baudRate: 115200,
  bufferSize: 10000,
  channels: [],
  protocol: 'justfloat',
  connectionType: 'serial',
  wsUrl: 'ws://localhost:8080'
}

// 默认波特率选项
export const BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600] as const

// 缓冲区大小限制
export const MIN_BUFFER_SIZE = 1000
export const MAX_BUFFER_SIZE = 1000000

// 同步字节
export const SYNC_BYTES = new Uint8Array([0x00, 0x00, 0x80, 0x7F])

// Web Serial API 类型声明
declare global {
  interface Navigator {
    serial: Serial
  }

  interface Serial {
    requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>
    getPorts(): Promise<SerialPort[]>
  }

  interface SerialPortRequestOptions {
    filters?: SerialPortFilter[]
  }

  interface SerialPortFilter {
    usbVendorId?: number
    usbProductId?: number
  }

  interface SerialPort {
    readable: ReadableStream<Uint8Array> | null
    writable: WritableStream<Uint8Array> | null
    open(options: SerialOptions): Promise<void>
    close(): Promise<void>
    getInfo(): SerialPortInfo
  }

  interface SerialOptions {
    baudRate: number
    dataBits?: number
    stopBits?: number
    parity?: 'none' | 'even' | 'odd'
    bufferSize?: number
    flowControl?: 'none' | 'hardware'
  }

  interface SerialPortInfo {
    usbVendorId?: number
    usbProductId?: number
  }
}

export {}
