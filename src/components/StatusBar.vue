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

    <!-- 中间链接 -->
    <div class="flex items-center gap-3 text-gray-500">
      <a
        href="mailto:createskyblue@outlook.com"
        class="hover:text-gray-300 transition-colors flex items-center gap-1"
        title="联系作者"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        <span class="hidden sm:inline">createskyblue@outlook.com</span>
      </a>
      <a
        href="https://github.com/createskyblue/justfloat-web-oscilloscope"
        target="_blank"
        rel="noopener noreferrer"
        class="hover:text-gray-300 transition-colors flex items-center gap-1"
        title="GitHub Pages"
      >
        <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
          <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
        </svg>
        <span class="hidden sm:inline">GitHub</span>
      </a>
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
