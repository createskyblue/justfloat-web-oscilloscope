<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ChannelConfig, ChannelStats, ProtocolType } from '@/types'
import { MIN_BUFFER_SIZE, MAX_BUFFER_SIZE, PROTOCOL_OPTIONS } from '@/types'
import ChannelItem from './ChannelItem.vue'

const props = defineProps<{
  bufferSize: number
  protocol: ProtocolType
  channels: ChannelConfig[]
  channelCount: number
  cursorValues: number[] | null
  cursorIndex: number | null
  getChannelStats: (channelIndex: number) => ChannelStats | null
  isDark: boolean
}>()

const emit = defineEmits<{
  'update:bufferSize': [value: number]
  'update:protocol': [value: ProtocolType]
  'updateChannel': [id: number, updates: Partial<ChannelConfig>]
  'toggleVisibility': [id: number]
}>()

// 本地状态（防止输入时被外部值覆盖）
const localBufferSize = ref(props.bufferSize)
const isEditingBufferSize = ref(false)

// 监听外部变化，仅在非编辑状态下同步
watch(() => props.bufferSize, (newVal) => {
  if (!isEditingBufferSize.value) {
    localBufferSize.value = newVal
  }
})

// 提交缓冲区大小
const commitBufferSize = () => {
  isEditingBufferSize.value = false
  const value = Math.max(MIN_BUFFER_SIZE, Math.min(MAX_BUFFER_SIZE, localBufferSize.value))
  localBufferSize.value = value
  emit('update:bufferSize', value)
}

// 显示的通道数量
const displayChannels = computed(() => {
  return props.channels.slice(0, props.channelCount)
})

// 获取指定通道的光标值（图表数据已应用系数，直接返回）
const getCursorValue = (channelId: number): number | null => {
  if (!props.cursorValues || channelId >= props.cursorValues.length) {
    return null
  }
  return props.cursorValues[channelId]
}
</script>

<template>
  <aside :class="['w-72 flex-shrink-0 border-r flex flex-col overflow-hidden', isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300']">
    <!-- 连接配置 -->
    <div :class="['p-4 border-b', isDark ? 'border-gray-700' : 'border-gray-300']">
      <h2 :class="['text-sm font-semibold mb-3', isDark ? 'text-gray-400' : 'text-gray-700']">连接配置</h2>

      <!-- 协议选择 -->
      <div class="mb-3">
        <label :class="['block text-xs mb-1', isDark ? 'text-gray-500' : 'text-gray-600']">协议类型</label>
        <select
          :value="protocol"
          :class="['w-full rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500', isDark ? 'bg-gray-700 border border-gray-600 text-white' : 'bg-white border border-gray-400 text-gray-900']"
          @change="emit('update:protocol', ($event.target as HTMLSelectElement).value as ProtocolType)"
        >
          <option v-for="opt in PROTOCOL_OPTIONS" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
        <div :class="['text-xs mt-1', isDark ? 'text-gray-600' : 'text-gray-500']">
          {{ PROTOCOL_OPTIONS.find(o => o.value === protocol)?.description }}
        </div>
      </div>

      <!-- 缓冲区大小 -->
      <div>
        <label :class="['block text-xs mb-1', isDark ? 'text-gray-500' : 'text-gray-600']">
          缓冲区大小 ({{ MIN_BUFFER_SIZE.toLocaleString() }} - {{ MAX_BUFFER_SIZE.toLocaleString() }})
        </label>
        <input
          type="number"
          v-model.number="localBufferSize"
          :min="MIN_BUFFER_SIZE"
          :max="MAX_BUFFER_SIZE"
          step="1000"
          :class="['w-full rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500', isDark ? 'bg-gray-700 border border-gray-600 text-white' : 'bg-white border border-gray-400 text-gray-900']"
          @focus="isEditingBufferSize = true"
          @blur="commitBufferSize"
          @keydown.enter="($event.target as HTMLInputElement).blur()"
        />
      </div>
    </div>

    <!-- 通道列表 -->
    <div class="flex-1 overflow-y-auto p-4">
      <h2 :class="['text-sm font-semibold mb-3', isDark ? 'text-gray-400' : 'text-gray-700']">
        通道 ({{ channelCount }})
      </h2>

      <div v-if="channelCount === 0" :class="['text-sm text-center py-4', isDark ? 'text-gray-500' : 'text-gray-500']">
        等待数据...
      </div>

      <div v-else class="space-y-2">
        <ChannelItem
          v-for="channel in displayChannels"
          :key="channel.id"
          :channel="channel"
          :stats="getChannelStats(channel.id)"
          :cursor-value="getCursorValue(channel.id)"
          :cursor-index="cursorIndex"
          :is-dark="isDark"
          @update="(updates) => emit('updateChannel', channel.id, updates)"
          @toggle-visibility="emit('toggleVisibility', channel.id)"
        />
      </div>
    </div>
  </aside>
</template>
