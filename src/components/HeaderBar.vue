<script setup lang="ts">
import type { ConnectionStatus } from '@/types'

defineProps<{
  status: ConnectionStatus
  isSupported: boolean
}>()

const emit = defineEmits<{
  connect: []
  clear: []
  export: []
  import: []
}>()

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
