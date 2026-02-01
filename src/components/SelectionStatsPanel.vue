<script setup lang="ts">
import { ref } from 'vue'
import type { ChannelConfig, SelectionStats } from '@/types'
import { CHANNEL_COLORS } from '@/types'
import { formatNumber, formatTime } from '@/utils/helpers'

defineProps<{
  stats: SelectionStats
  channels: ChannelConfig[]
  isDark: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

// 模态框拖动状态
const panelRef = ref<HTMLDivElement | null>(null)
const panelPosition = ref({ x: 8, y: 8 })
const isDragging = ref(false)
const dragOffset = ref({ x: 0, y: 0 })

// 开始拖动
const startDrag = (e: MouseEvent) => {
  if (!panelRef.value) return
  isDragging.value = true
  const rect = panelRef.value.getBoundingClientRect()
  dragOffset.value = {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  }
  document.addEventListener('mousemove', onDrag)
  document.addEventListener('mouseup', stopDrag)
}

// 拖动中
const onDrag = (e: MouseEvent) => {
  if (!isDragging.value || !panelRef.value) return

  // 获取父容器的位置（OscilloscopeChart 的根容器）
  const parentRect = panelRef.value.parentElement?.getBoundingClientRect()
  if (!parentRect) return

  // 计算相对于父容器的坐标
  let newX = e.clientX - parentRect.left - dragOffset.value.x
  let newY = e.clientY - parentRect.top - dragOffset.value.y

  // 限制在父容器内
  newX = Math.max(0, Math.min(newX, parentRect.width - 200))
  newY = Math.max(0, Math.min(newY, parentRect.height - 100))

  panelPosition.value = { x: newX, y: newY }
}

// 停止拖动
const stopDrag = () => {
  isDragging.value = false
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', stopDrag)
}
</script>

<template>
  <div
    ref="panelRef"
    :class="['absolute backdrop-blur rounded-lg p-3 z-10 border max-h-[80%] overflow-y-auto shadow-xl', isDark ? 'bg-gray-900/95 border-gray-700' : 'bg-white/98 border-gray-400 shadow-lg', { 'cursor-grabbing': isDragging }]"
    :style="{
      left: panelPosition.x + 'px',
      top: panelPosition.y + 'px',
      minWidth: '200px',
      maxWidth: '280px'
    }"
  >
    <!-- 拖动手柄 -->
    <div
      class="flex items-center justify-between mb-2 select-none cursor-grab"
      :class="{ 'cursor-grabbing': isDragging }"
      @mousedown="startDrag"
    >
      <div class="flex items-center gap-2">
        <svg :class="['w-4 h-4', isDark ? 'text-gray-500' : 'text-gray-600']" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM14 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM14 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0z"/>
        </svg>
        <h3 :class="['text-sm font-semibold', isDark ? 'text-white' : 'text-gray-900']">选区数据分析</h3>
      </div>
      <button
        :class="['p-1', isDark ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900']"
        @click.stop="emit('close')"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <!-- 基本信息 - 紧凑布局 -->
    <div class="grid grid-cols-2 gap-2 mb-3 text-xs">
      <div>
        <span :class="isDark ? 'text-gray-500' : 'text-gray-600'">采样点</span>
        <div :class="['font-mono', isDark ? 'text-white' : 'text-gray-900']">{{ stats.pointCount?.toLocaleString() }}</div>
      </div>
      <div>
        <span :class="isDark ? 'text-gray-500' : 'text-gray-600'">时长</span>
        <div :class="['font-mono', isDark ? 'text-white' : 'text-gray-900']">{{ formatTime(stats.duration) }}</div>
      </div>
      <div>
        <span :class="isDark ? 'text-gray-500' : 'text-gray-600'">频率</span>
        <div :class="['font-mono', isDark ? 'text-white' : 'text-gray-900']">{{ formatNumber(stats.frequency, 0) }}Hz</div>
      </div>
      <div>
        <span :class="isDark ? 'text-gray-500' : 'text-gray-600'">范围</span>
        <div :class="['font-mono text-xs', isDark ? 'text-white' : 'text-gray-900']">{{ stats.startIndex }}-{{ stats.endIndex }}</div>
      </div>
    </div>

    <!-- 通道统计 - 垂直堆叠 -->
    <div :class="['border-t pt-2 space-y-2', isDark ? 'border-gray-700' : 'border-gray-300']">
      <div
        v-for="ch in stats.channels"
        :key="ch.id"
        :class="['rounded p-2 border', isDark ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-300 shadow-sm']"
      >
        <div class="flex items-center gap-1.5 mb-1.5">
          <span
            class="w-2 h-2 rounded-full flex-shrink-0"
            :style="{ backgroundColor: channels[ch.id]?.color || CHANNEL_COLORS[ch.id % CHANNEL_COLORS.length] }"
          ></span>
          <span :class="['text-xs font-medium truncate', isDark ? 'text-gray-300' : 'text-gray-800']">
            {{ channels[ch.id]?.name || `通道 ${ch.id + 1}` }}
          </span>
        </div>
        <div class="grid grid-cols-3 gap-2 text-xs">
          <div>
            <div :class="isDark ? 'text-gray-600' : 'text-gray-600'">最小</div>
            <div class="text-green-500 font-mono">{{ formatNumber(ch.min) }}</div>
          </div>
          <div>
            <div :class="isDark ? 'text-gray-600' : 'text-gray-600'">最大</div>
            <div class="text-red-500 font-mono">{{ formatNumber(ch.max) }}</div>
          </div>
          <div>
            <div :class="isDark ? 'text-gray-600' : 'text-gray-600'">平均</div>
            <div class="text-blue-500 font-mono">{{ formatNumber(ch.avg) }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
