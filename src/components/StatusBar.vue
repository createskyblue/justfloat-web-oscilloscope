<script setup lang="ts">
import type { ConnectionStatus } from '@/types'
import { formatLargeNumber, formatFrequency } from '@/utils/helpers'

defineProps<{
  status: ConnectionStatus
  errorMessage: string
  sampleRate: number
  totalPoints: number
  frameCount: number
  channelCount: number
}>()

const statusColor = {
  disconnected: 'text-gray-500',
  connecting: 'text-yellow-400',
  connected: 'text-green-400',
  error: 'text-red-400'
}

const statusText = {
  disconnected: '未连接',
  connecting: '连接中',
  connected: '已连接',
  error: '连接错误'
}
</script>

<template>
  <footer class="bg-gray-800 border-t border-gray-700 px-4 py-2 flex items-center justify-between text-xs">
    <!-- 左侧状态 -->
    <div class="flex items-center gap-4">
      <!-- 连接状态 -->
      <div class="flex items-center gap-1.5">
        <span class="w-1.5 h-1.5 rounded-full" :class="statusColor[status].replace('text-', 'bg-')"></span>
        <span :class="statusColor[status]">{{ statusText[status] }}</span>
        <span v-if="errorMessage" class="text-red-400 ml-1">- {{ errorMessage }}</span>
      </div>

      <!-- 通道数 -->
      <div v-if="channelCount > 0" class="text-gray-400">
        通道: <span class="text-gray-300">{{ channelCount }}</span>
      </div>
    </div>

    <!-- 右侧统计 -->
    <div class="flex items-center gap-4 text-gray-400">
      <!-- 采样率 -->
      <div v-if="sampleRate > 0">
        采样率: <span class="text-gray-300 font-mono">{{ formatFrequency(sampleRate) }}</span>
      </div>

      <!-- 数据点数 -->
      <div>
        数据点: <span class="text-gray-300 font-mono">{{ formatLargeNumber(totalPoints) }}</span>
      </div>

      <!-- 帧计数 -->
      <div>
        帧数: <span class="text-gray-300 font-mono">{{ formatLargeNumber(frameCount) }}</span>
      </div>
    </div>
  </footer>
</template>
