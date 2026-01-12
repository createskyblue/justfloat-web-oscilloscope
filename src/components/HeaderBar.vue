<script setup lang="ts">
import { ref, watch } from 'vue'
import type { ConnectionStatus, ConnectionType } from '@/types'
import { CONNECTION_TYPE_OPTIONS, BAUD_RATES } from '@/types'

const props = defineProps<{
  status: ConnectionStatus
  isSupported: boolean
  connectionType: ConnectionType
  wsUrl: string
  btServiceUUID: string
  btCharacteristicUUID: string
  baudRate: number
}>()

const emit = defineEmits<{
  connect: []
  clear: []
  export: []
  import: []
  'update:connectionType': [value: ConnectionType]
  'update:wsUrl': [value: string]
  'update:btServiceUUID': [value: string]
  'update:btCharacteristicUUID': [value: string]
  'update:baudRate': [value: number]
}>()

const localWsUrl = ref(props.wsUrl)
const localBtServiceUUID = ref(props.btServiceUUID)
const localBtCharacteristicUUID = ref(props.btCharacteristicUUID)
const localBaudRate = ref(props.baudRate)

watch(() => props.wsUrl, (val) => {
  localWsUrl.value = val
})

watch(() => props.btServiceUUID, (val) => {
  localBtServiceUUID.value = val
})

watch(() => props.btCharacteristicUUID, (val) => {
  localBtCharacteristicUUID.value = val
})

watch(() => props.baudRate, (val) => {
  localBaudRate.value = val
})

const updateWsUrl = () => {
  emit('update:wsUrl', localWsUrl.value)
}

const updateBtServiceUUID = () => {
  emit('update:btServiceUUID', localBtServiceUUID.value)
}

const updateBtCharacteristicUUID = () => {
  emit('update:btCharacteristicUUID', localBtCharacteristicUUID.value)
}

const updateBaudRate = () => {
  const value = Math.max(300, localBaudRate.value || 115200)
  localBaudRate.value = value
  emit('update:baudRate', value)
}

const handleConnectionTypeChange = (event: Event) => {
  const target = event.target as HTMLSelectElement
  emit('update:connectionType', target.value as ConnectionType)
}

const statusText = {
  disconnected: '未连接',
  connecting: '连接中...',
  connected: '已连接',
  error: '错误'
}

const statusColor = {
  disconnected: 'bg-gray-500',
  connecting: 'bg-yellow-500',
  connected: 'bg-green-500',
  error: 'bg-red-500'
}
</script>

<template>
  <header class="bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center justify-between">
    <!-- 标题 -->
    <div class="flex items-center gap-3">
      <h1 class="text-xl font-semibold text-white">JustFloat 示波器</h1>
      <span class="text-xs text-gray-500">Web Serial Protocol Analyzer</span>
    </div>

    <!-- 工具按钮组 -->
    <div class="flex items-center gap-2">
      <!-- 导入 -->
      <button
        class="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
        @click="emit('import')"
      >
        导入
      </button>

      <!-- 导出 -->
      <button
        class="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
        @click="emit('export')"
      >
        导出
      </button>

      <!-- 清除 -->
      <button
        class="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
        @click="emit('clear')"
      >
        清除
      </button>

      <div class="w-px h-6 bg-gray-600 mx-2"></div>

      <!-- 连接方式选择 -->
      <select
        :value="connectionType"
        class="px-2 py-1.5 text-sm bg-gray-700 text-gray-300 rounded border border-gray-600 focus:outline-none focus:border-blue-500"
        :disabled="status === 'connected' || status === 'connecting'"
        @change="handleConnectionTypeChange"
      >
        <option
          v-for="option in CONNECTION_TYPE_OPTIONS"
          :key="option.value"
          :value="option.value"
        >
          {{ option.label }}
        </option>
      </select>

      <!-- 串口波特率输入 -->
      <div v-if="connectionType === 'serial'" class="flex items-center gap-1">
        <input
          v-model.number="localBaudRate"
          type="number"
          list="baudRateList"
          min="300"
          max="4000000"
          placeholder="115200"
          class="px-2 py-1.5 text-sm bg-gray-700 text-gray-300 rounded border border-gray-600 focus:outline-none focus:border-blue-500 w-28"
          :disabled="status === 'connected' || status === 'connecting'"
          @blur="updateBaudRate"
          @keyup.enter="updateBaudRate"
        />
        <datalist id="baudRateList">
          <option v-for="rate in BAUD_RATES" :key="rate" :value="rate" />
        </datalist>
        <span class="text-xs text-gray-500">bps</span>
      </div>

      <!-- WebSocket 地址输入 -->
      <input
        v-if="connectionType === 'websocket'"
        v-model="localWsUrl"
        type="text"
        placeholder="ws://localhost:8080"
        class="px-2 py-1.5 text-sm bg-gray-700 text-gray-300 rounded border border-gray-600 focus:outline-none focus:border-blue-500 w-48"
        :disabled="status === 'connected' || status === 'connecting'"
        @blur="updateWsUrl"
        @keyup.enter="updateWsUrl"
      />

      <!-- 蓝牙 UUID 输入 -->
      <template v-if="connectionType === 'bluetooth'">
        <input
          v-model="localBtServiceUUID"
          type="text"
          placeholder="服务 UUID (如 ffe0)"
          class="px-2 py-1.5 text-sm bg-gray-700 text-gray-300 rounded border border-gray-600 focus:outline-none focus:border-blue-500 w-36"
          :disabled="status === 'connected' || status === 'connecting'"
          @blur="updateBtServiceUUID"
          @keyup.enter="updateBtServiceUUID"
        />
        <input
          v-model="localBtCharacteristicUUID"
          type="text"
          placeholder="特征 UUID (如 ffe1)"
          class="px-2 py-1.5 text-sm bg-gray-700 text-gray-300 rounded border border-gray-600 focus:outline-none focus:border-blue-500 w-36"
          :disabled="status === 'connected' || status === 'connecting'"
          @blur="updateBtCharacteristicUUID"
          @keyup.enter="updateBtCharacteristicUUID"
        />
      </template>

      <div class="w-px h-6 bg-gray-600 mx-2"></div>

      <!-- 连接状态 -->
      <div class="flex items-center gap-2">
        <span
          class="w-2 h-2 rounded-full"
          :class="statusColor[status]"
        ></span>
        <span class="text-sm text-gray-400">{{ statusText[status] }}</span>
      </div>

      <!-- 连接按钮 -->
      <button
        v-if="isSupported"
        class="px-4 py-1.5 text-sm rounded transition-colors"
        :class="status === 'connected'
          ? 'bg-red-600 hover:bg-red-700 text-white'
          : 'bg-blue-600 hover:bg-blue-700 text-white'"
        :disabled="status === 'connecting'"
        @click="emit('connect')"
      >
        {{ status === 'connected' ? '断开' : status === 'connecting' ? '连接中...' : '连接' }}
      </button>

      <span v-else class="text-sm text-red-400">
        浏览器不支持 Web Serial API
      </span>
    </div>
  </header>
</template>
