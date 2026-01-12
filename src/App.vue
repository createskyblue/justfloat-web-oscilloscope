<script setup lang="ts">
import { ref, watch, onUnmounted, provide, computed } from 'vue'
import HeaderBar from './components/HeaderBar.vue'
import SidePanel from './components/SidePanel.vue'
import OscilloscopeChart from './components/OscilloscopeChart.vue'
import StatusBar from './components/StatusBar.vue'
import { useSerial } from './composables/useSerial'
import { useWebSocket } from './composables/useWebSocket'
import { useProtocolParser } from './composables/useProtocolParser'
import { useDataBuffer } from './composables/useDataBuffer'
import { useChannelConfig } from './composables/useChannelConfig'
import { useStorage } from './composables/useStorage'
import type { AppConfig, ExportData, ProtocolType, ConnectionType } from './types'
import { downloadJson, readJsonFile } from './utils/helpers'

// 初始化存储
const { loadConfig, saveConfig } = useStorage()
const savedConfig = loadConfig()

// 初始化各模块
const serial = useSerial()
const websocket = useWebSocket()
const parser = useProtocolParser()
const buffer = useDataBuffer(savedConfig.bufferSize)
const channelConfig = useChannelConfig()

// 加载通道配置
if (savedConfig.channels.length > 0) {
  channelConfig.loadChannels(savedConfig.channels)
}

// 配置状态
const baudRate = ref(savedConfig.baudRate)
const bufferSize = ref(savedConfig.bufferSize)
const protocol = ref<ProtocolType>(savedConfig.protocol || 'justfloat')
const connectionType = ref<ConnectionType>(savedConfig.connectionType || 'serial')
const wsUrl = ref(savedConfig.wsUrl || 'ws://localhost:8080')

// 当前连接模块（根据连接类型切换）
const currentConnection = computed(() =>
  connectionType.value === 'websocket' ? websocket : serial
)

// 光标值状态
const cursorValues = ref<number[] | null>(null)
const cursorIndex = ref<number | null>(null)

// 初始化协议
parser.setProtocol(protocol.value)

// 连接串口时的波特率
const handleConnect = async () => {
  const conn = currentConnection.value
  if (conn.status.value === 'connected') {
    await conn.disconnect()
    // 只重置parser状态，不清空数据buffer
    parser.reset()
  } else {
    if (connectionType.value === 'websocket') {
      await websocket.connect(wsUrl.value)
    } else {
      await serial.connect(baudRate.value)
    }
  }
}

// 数据回调
const handleData = (data: Uint8Array) => {
  parser.processData(data)
}

// 串口数据回调
serial.onData(handleData)

// WebSocket 数据回调
websocket.onData(handleData)

// 协议帧批量回调（高性能）
parser.onFramesBatch((frames) => {
  buffer.addFrames(frames)
})

// 当通道数变化时更新配置
watch(() => parser.channelCount.value, (count) => {
  if (count > 0) {
    channelConfig.ensureChannels(count)
  }
})

// 保存配置
watch([baudRate, bufferSize, protocol, connectionType, wsUrl, () => channelConfig.channels.value], () => {
  const config: AppConfig = {
    baudRate: baudRate.value,
    bufferSize: bufferSize.value,
    protocol: protocol.value,
    connectionType: connectionType.value,
    wsUrl: wsUrl.value,
    channels: channelConfig.channels.value
  }
  saveConfig(config)
}, { deep: true })

// 协议变化时更新解析器
watch(protocol, (newProtocol) => {
  parser.setProtocol(newProtocol)
})

// 缓冲区大小变化
watch(bufferSize, (size) => {
  buffer.setBufferSize(size)
})

// 清除数据
const handleClear = () => {
  buffer.clear()
  parser.fullReset()
  cursorValues.value = null
  cursorIndex.value = null
}

// 光标值变化
const handleCursorValues = (values: number[] | null, index: number | null) => {
  cursorValues.value = values
  cursorIndex.value = index
}

// 导出数据
const handleExport = () => {
  const exportData: ExportData = {
    config: {
      baudRate: baudRate.value,
      bufferSize: bufferSize.value,
      protocol: protocol.value,
      connectionType: connectionType.value,
      wsUrl: wsUrl.value,
      channels: channelConfig.channels.value
    },
    data: buffer.exportData(),
    sampleRate: buffer.sampleRate.value,
    exportTime: new Date().toISOString()
  }
  const filename = `oscilloscope-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`
  downloadJson(exportData, filename)
}

// 导入数据
const handleImport = async () => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return

    try {
      const data = await readJsonFile<ExportData>(file)
      if (data.config) {
        baudRate.value = data.config.baudRate
        bufferSize.value = data.config.bufferSize
        if (data.config.channels) {
          channelConfig.loadChannels(data.config.channels)
        }
      }
      if (data.data && data.data.length > 0) {
        buffer.importData(data.data)
        // 根据导入的数据确定通道数
        const firstFrame = data.data[0]
        if (firstFrame && firstFrame.values) {
          parser.setChannelCount(firstFrame.values.length)
          channelConfig.ensureChannels(firstFrame.values.length)
        }
      }
    } catch (error) {
      alert('导入失败: ' + (error as Error).message)
    }
  }
  input.click()
}

// 提供给子组件
provide('serial', serial)
provide('parser', parser)
provide('buffer', buffer)
provide('channelConfig', channelConfig)

// 清理
onUnmounted(() => {
  serial.disconnect()
  websocket.disconnect()
})
</script>

<template>
  <div class="h-screen flex flex-col bg-gray-900">
    <!-- 顶部导航栏 -->
    <HeaderBar
      :status="currentConnection.status.value"
      :is-supported="connectionType === 'websocket' || serial.isSupported()"
      :connection-type="connectionType"
      :ws-url="wsUrl"
      @connect="handleConnect"
      @clear="handleClear"
      @export="handleExport"
      @import="handleImport"
      @update:connection-type="connectionType = $event"
      @update:ws-url="wsUrl = $event"
    />

    <!-- 主内容区 -->
    <div class="flex-1 flex overflow-hidden">
      <!-- 左侧面板 -->
      <SidePanel
        v-model:baud-rate="baudRate"
        v-model:buffer-size="bufferSize"
        v-model:protocol="protocol"
        :channels="channelConfig.channels.value"
        :channel-count="parser.channelCount.value"
        :cursor-values="cursorValues"
        :cursor-index="cursorIndex"
        :get-channel-stats="(id: number) => buffer.getChannelStats(id, channelConfig.channels.value[id]?.coefficient ?? 1)"
        @update-channel="channelConfig.updateChannel"
        @toggle-visibility="channelConfig.toggleVisibility"
      />

      <!-- 图表区域 -->
      <div class="flex-1 min-w-0 p-4">
        <OscilloscopeChart
          :data="buffer.data.value"
          :data-version="buffer.dataVersion.value"
          :channels="channelConfig.channels.value"
          :channel-count="parser.channelCount.value"
          :sample-rate="buffer.sampleRate.value"
          :total-points="buffer.totalPoints.value"
          :get-chart-data="() => buffer.getChartData(parser.channelCount.value, channelConfig.getCoefficients())"
          :get-chart-data-in-range="(start: number, end: number) => buffer.getChartDataInRange(start, end, parser.channelCount.value, channelConfig.getCoefficients())"
          :get-selection-stats="(start: number, end: number) => buffer.getSelectionStats(start, end, parser.channelCount.value, channelConfig.getCoefficients())"
          @cursor-values="handleCursorValues"
        />
      </div>
    </div>

    <!-- 状态栏 -->
    <StatusBar
      :status="currentConnection.status.value"
      :error-message="currentConnection.errorMessage.value"
      :sample-rate="buffer.sampleRate.value"
      :total-points="buffer.totalPoints.value"
      :frame-count="parser.frameCount.value"
      :channel-count="parser.channelCount.value"
    />
  </div>
</template>