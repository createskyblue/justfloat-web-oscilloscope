<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { ChannelConfig, ChannelStats } from '@/types'
import { CHANNEL_COLORS } from '@/types'
import { formatNumber } from '@/utils/helpers'

const props = defineProps<{
  channel: ChannelConfig
  stats: ChannelStats | null
}>()

const emit = defineEmits<{
  update: [updates: Partial<ChannelConfig>]
  toggleVisibility: []
}>()

const isExpanded = ref(false)
const showColorPicker = ref(false)

// 本地编辑状态（防止输入时被外部更新覆盖）
const localName = ref(props.channel.name)
const localUnit = ref(props.channel.unit)
const localCoefficient = ref(props.channel.coefficient)
const isEditingName = ref(false)
const isEditingUnit = ref(false)
const isEditingCoefficient = ref(false)

// 当channel变化且不在编辑状态时，同步本地值
watch(() => props.channel.name, (newVal) => {
  if (!isEditingName.value) localName.value = newVal
})
watch(() => props.channel.unit, (newVal) => {
  if (!isEditingUnit.value) localUnit.value = newVal
})
watch(() => props.channel.coefficient, (newVal) => {
  if (!isEditingCoefficient.value) localCoefficient.value = newVal
})

// 提交编辑
const submitName = () => {
  isEditingName.value = false
  const value = localName.value || `通道 ${props.channel.id + 1}`
  if (value !== props.channel.name) {
    emit('update', { name: value })
  }
}

const submitUnit = () => {
  isEditingUnit.value = false
  if (localUnit.value !== props.channel.unit) {
    emit('update', { unit: localUnit.value })
  }
}

const submitCoefficient = () => {
  isEditingCoefficient.value = false
  const value = localCoefficient.value || 1
  if (value !== props.channel.coefficient) {
    emit('update', { coefficient: value })
  }
}

// 峰峰值计算
const peakToPeak = computed(() => {
  if (!props.stats) return 0
  return props.stats.max - props.stats.min
})

// 预设颜色选项
const colorOptions = CHANNEL_COLORS

const selectColor = (color: string) => {
  emit('update', { color })
  showColorPicker.value = false
}
</script>

<template>
  <div
    class="rounded-lg border transition-all duration-200"
    :class="channel.visible
      ? 'border-gray-600 bg-gray-700/50'
      : 'border-gray-700 bg-gray-800/50 opacity-50'"
  >
    <!-- 通道头部 -->
    <div
      class="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-700/50 rounded-t-lg transition-colors"
      @click="isExpanded = !isExpanded"
    >
      <!-- 颜色指示器（可点击更换颜色） -->
      <div class="relative">
        <button
          class="w-3 h-3 rounded-full flex-shrink-0 ring-2 ring-transparent hover:ring-white/30 transition-all"
          :style="{ backgroundColor: channel.color }"
          @click.stop="showColorPicker = !showColorPicker"
          title="点击更换颜色"
        ></button>

        <!-- 颜色选择器 -->
        <div
          v-if="showColorPicker"
          class="absolute left-0 top-5 bg-gray-800 border border-gray-600 rounded-lg p-2 z-20 shadow-xl"
          @click.stop
        >
          <div class="grid grid-cols-4 gap-1.5">
            <button
              v-for="color in colorOptions"
              :key="color"
              class="w-5 h-5 rounded-full transition-transform hover:scale-110"
              :class="{ 'ring-2 ring-white': channel.color === color }"
              :style="{ backgroundColor: color }"
              @click="selectColor(color)"
            ></button>
          </div>
        </div>
      </div>

      <!-- 通道名称 -->
      <span class="flex-1 text-sm text-white truncate">
        {{ channel.name }}
        <span v-if="channel.unit" class="text-gray-400 text-xs ml-1">({{ channel.unit }})</span>
      </span>

      <!-- 当前值 -->
      <span v-if="stats" class="text-sm font-mono text-gray-200 tabular-nums">
        {{ formatNumber(stats.current, 3) }}
        <span v-if="channel.unit" class="text-gray-500 text-xs">{{ channel.unit }}</span>
      </span>

      <!-- 可见性开关 -->
      <button
        class="p-1 rounded hover:bg-gray-600 transition-colors"
        :class="channel.visible ? 'text-blue-400' : 'text-gray-500'"
        @click.stop="emit('toggleVisibility')"
        :title="channel.visible ? '隐藏通道' : '显示通道'"
      >
        <svg v-if="channel.visible" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
        <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
        </svg>
      </button>

      <!-- 展开箭头 -->
      <svg
        class="w-4 h-4 text-gray-500 transition-transform duration-200"
        :class="{ 'rotate-180': isExpanded }"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </div>

    <!-- 实时统计信息（未展开时显示简化版） -->
    <div v-if="stats && !isExpanded" class="px-3 pb-2">
      <div class="grid grid-cols-4 gap-1 text-xs">
        <div class="text-center">
          <div class="text-gray-500">最小</div>
          <div class="text-green-400 font-mono tabular-nums">{{ formatNumber(stats.min, 3) }}</div>
        </div>
        <div class="text-center">
          <div class="text-gray-500">最大</div>
          <div class="text-red-400 font-mono tabular-nums">{{ formatNumber(stats.max, 3) }}</div>
        </div>
        <div class="text-center">
          <div class="text-gray-500">平均</div>
          <div class="text-blue-400 font-mono tabular-nums">{{ formatNumber(stats.avg, 3) }}</div>
        </div>
        <div class="text-center">
          <div class="text-gray-500">峰峰</div>
          <div class="text-purple-400 font-mono tabular-nums">{{ formatNumber(peakToPeak, 3) }}</div>
        </div>
      </div>
    </div>

    <!-- 展开配置面板 -->
    <div v-if="isExpanded" class="px-3 pb-3 pt-1 space-y-3 border-t border-gray-700">
      <!-- 名称设置 -->
      <div>
        <label class="block text-xs text-gray-500 mb-1">通道名称</label>
        <input
          type="text"
          v-model="localName"
          class="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
          placeholder="输入通道名称"
          @focus="isEditingName = true"
          @blur="submitName"
          @keyup.enter="($event.target as HTMLInputElement).blur()"
        />
      </div>

      <!-- 单位和系数 -->
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="block text-xs text-gray-500 mb-1">单位</label>
          <input
            type="text"
            v-model="localUnit"
            placeholder="V, A, °C..."
            class="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
            @focus="isEditingUnit = true"
            @blur="submitUnit"
            @keyup.enter="($event.target as HTMLInputElement).blur()"
          />
        </div>
        <div>
          <label class="block text-xs text-gray-500 mb-1">系数</label>
          <input
            type="number"
            v-model.number="localCoefficient"
            step="0.000001"
            placeholder="1.0"
            class="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
            @focus="isEditingCoefficient = true"
            @blur="submitCoefficient"
            @keyup.enter="($event.target as HTMLInputElement).blur()"
          />
        </div>
      </div>

      <!-- 详细统计信息 -->
      <div v-if="stats" class="pt-2 border-t border-gray-700">
        <div class="text-xs text-gray-500 mb-2">实时统计</div>
        <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div class="flex justify-between">
            <span class="text-gray-500">最小值:</span>
            <span class="text-green-400 font-mono tabular-nums">{{ formatNumber(stats.min) }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-500">最大值:</span>
            <span class="text-red-400 font-mono tabular-nums">{{ formatNumber(stats.max) }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-500">平均值:</span>
            <span class="text-blue-400 font-mono tabular-nums">{{ formatNumber(stats.avg) }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-500">当前值:</span>
            <span class="text-white font-mono tabular-nums">{{ formatNumber(stats.current) }}</span>
          </div>
          <div class="flex justify-between col-span-2 pt-1 border-t border-gray-700 mt-1">
            <span class="text-gray-500">峰峰值:</span>
            <span class="text-purple-400 font-mono tabular-nums">{{ formatNumber(peakToPeak) }}</span>
          </div>
        </div>
      </div>

      <!-- 快速操作 -->
      <div class="flex gap-2 pt-2">
        <button
          class="flex-1 px-2 py-1 text-xs rounded transition-colors"
          :class="channel.visible
            ? 'bg-gray-600 hover:bg-gray-500 text-white'
            : 'bg-blue-600 hover:bg-blue-500 text-white'"
          @click="emit('toggleVisibility')"
        >
          {{ channel.visible ? '隐藏通道' : '显示通道' }}
        </button>
        <button
          class="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
          @click="emit('update', {
            name: `通道 ${channel.id + 1}`,
            unit: '',
            coefficient: 1
          })"
          title="重置为默认值"
        >
          重置
        </button>
      </div>
    </div>
  </div>
</template>
