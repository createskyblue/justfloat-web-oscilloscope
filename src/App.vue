<script setup lang="ts">
import { ref, watch, onUnmounted, provide, computed, onMounted } from 'vue'
import HeaderBar from './components/HeaderBar.vue'
import SidePanel from './components/SidePanel.vue'
import OscilloscopeChart from './components/OscilloscopeChart.vue'
import SelectionStatsPanel from './components/SelectionStatsPanel.vue'
import StatusBar from './components/StatusBar.vue'
import { useSerial } from './composables/useSerial'
import { useWebSocket } from './composables/useWebSocket'
import { useBluetooth } from './composables/useBluetooth'
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
const bluetooth = useBluetooth()
const parser = useProtocolParser()
const buffer = useDataBuffer(savedConfig.bufferSize)
const channelConfig = useChannelConfig()

// 加载通道配置
if (savedConfig.channels.length > 0) {
  channelConfig.loadChannels(savedConfig.channels)
}

// 主题状态
const isDark = ref(savedConfig.isDark ?? true)

// 初始化主题
onMounted(() => {
  updateThemeClass()
})

// 更新主题类
const updateThemeClass = () => {
  if (isDark.value) {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
}

// 切换主题
const toggleTheme = () => {
  isDark.value = !isDark.value
  updateThemeClass()
}


// 配置状态
const baudRate = ref(savedConfig.baudRate)
const bufferSize = ref(savedConfig.bufferSize)
const protocol = ref<ProtocolType>(savedConfig.protocol || 'justfloat')
const connectionType = ref<ConnectionType>(savedConfig.connectionType || 'serial')
const wsUrl = ref(savedConfig.wsUrl || 'ws://localhost:8080')
const btServiceUUID = ref(savedConfig.btServiceUUID || 'ffe0')
const btCharacteristicUUID = ref(savedConfig.btCharacteristicUUID || 'ffe1')

// 当前连接模块（根据连接类型切换）
const currentConnection = computed(() => {
  switch (connectionType.value) {
    case 'websocket':
      return websocket
    case 'bluetooth':
      return bluetooth
    default:
      return serial
  }
})

// 光标值状态
const cursorValues = ref<number[] | null>(null)
const cursorIndex = ref<number | null>(null)

// 选区统计状态
const selectionStats = ref<import('./types').SelectionStats | null>(null)

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
      // 在连接 WebSocket 之前检查协议兼容性
      const checkResult = websocket.checkProtocolCompatibility(wsUrl.value)
      if (!checkResult.compatible) {
        // 显示警告对话框
        alert(checkResult.reason || 'WebSocket 协议不兼容')
        return
      }
      await websocket.connect(wsUrl.value)
    } else if (connectionType.value === 'bluetooth') {
      await bluetooth.connect({
        serviceUUID: btServiceUUID.value,
        characteristicUUID: btCharacteristicUUID.value
      })
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

// 蓝牙数据回调
bluetooth.onData(handleData)

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
watch([baudRate, bufferSize, protocol, connectionType, wsUrl, btServiceUUID, btCharacteristicUUID, () => channelConfig.channels.value], () => {
  const config: AppConfig = {
    baudRate: baudRate.value,
    bufferSize: bufferSize.value,
    protocol: protocol.value,
    connectionType: connectionType.value,
    wsUrl: wsUrl.value,
    btServiceUUID: btServiceUUID.value,
    btCharacteristicUUID: btCharacteristicUUID.value,
    channels: channelConfig.channels.value,
    isDark: isDark.value
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
      btServiceUUID: btServiceUUID.value,
      btCharacteristicUUID: btCharacteristicUUID.value,
      channels: channelConfig.channels.value
    },
    channels: buffer.exportData(),
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
      console.log('开始导入文件:', file.name)
      const data = await readJsonFile<ExportData>(file)
      console.log('解析后的数据:', data)

      if (data.config) {
        console.log('导入配置:', data.config)
        baudRate.value = data.config.baudRate
        bufferSize.value = data.config.bufferSize
        if (data.config.channels) {
          channelConfig.loadChannels(data.config.channels)
        }
      }

      // 导入通道数据
      if (data.channels && data.channels.length > 0) {
        console.log('通道数据长度:', data.channels.length)
        console.log('第一个通道数据点数:', data.channels[0]?.length)
        console.log('采样率:', data.sampleRate)
        const channelCount = data.channels.length
        parser.setChannelCount(channelCount)
        channelConfig.ensureChannels(channelCount)
        buffer.importChannels(data.channels, channelCount, data.sampleRate)
        console.log('导入完成，总数据点:', buffer.totalPoints.value)
        alert('导入成功！共导入 ' + buffer.totalPoints.value + ' 个数据点')
      } else {
        console.error('没有找到通道数据')
        alert('导入失败：文件中没有找到通道数据，请确保导出了正确的文件格式')
      }
    } catch (error) {
      console.error('导入失败:', error)
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
  bluetooth.disconnect()
})
</script>

<template>
  <div :class="['h-screen flex flex-col', isDark ? 'bg-gray-900' : 'bg-white']">
    <!-- 顶部导航栏 -->
    <HeaderBar
      :status="currentConnection.status.value"
      :is-supported="connectionType === 'websocket' || (connectionType === 'bluetooth' ? bluetooth.isSupported() : serial.isSupported())"
      :connection-type="connectionType"
      :ws-url="wsUrl"
      :bt-service-u-u-i-d="btServiceUUID"
      :bt-characteristic-u-u-i-d="btCharacteristicUUID"
      :baud-rate="baudRate"
      :is-dark="isDark"
      @connect="handleConnect"
      @clear="handleClear"
      @export="handleExport"
      @import="handleImport"
      @toggle-theme="toggleTheme"
      @update:connection-type="connectionType = $event"
      @update:ws-url="wsUrl = $event"
      @update:bt-service-u-u-i-d="btServiceUUID = $event"
      @update:bt-characteristic-u-u-i-d="btCharacteristicUUID = $event"
      @update:baud-rate="baudRate = $event"
    />

    <!-- 主内容区 -->
    <div class="flex-1 flex overflow-hidden">
      <!-- 左侧面板 -->
      <SidePanel
        v-model:buffer-size="bufferSize"
        v-model:protocol="protocol"
        :channels="channelConfig.channels.value"
        :channel-count="parser.channelCount.value"
        :cursor-values="cursorValues"
        :cursor-index="cursorIndex"
        :get-channel-stats="(id: number) => buffer.getChannelStats(id, channelConfig.channels.value[id]?.coefficient ?? 1)"
        :is-dark="isDark"
        @update-channel="channelConfig.updateChannel"
        @toggle-visibility="channelConfig.toggleVisibility"
      />

      <!-- 图表区域 -->
      <div class="flex-1 min-w-0 p-4">
        <OscilloscopeChart
          :channels="channelConfig.channels.value"
          :channel-count="parser.channelCount.value"
          :sample-rate="buffer.sampleRate.value"
          :total-points="buffer.totalPoints.value"
          :chart-data="buffer.getChartData(parser.channelCount.value, channelConfig.getCoefficients())"
          :full-data="buffer.getChartData(parser.channelCount.value, channelConfig.getCoefficients())"
          :is-dark="isDark"
          @selection-change="selectionStats = $event"
          @cursor-values="handleCursorValues"
        >
          <!-- 选区统计面板插槽 -->
          <template #stats-panel="{ stats, resetZoom }">
            <SelectionStatsPanel
              v-if="stats"
              :stats="stats"
              :channels="channelConfig.channels.value"
              :is-dark="isDark"
              @close="resetZoom"
            />
          </template>
        </OscilloscopeChart>
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
      :is-dark="isDark"
    />
  </div>
</template>
