<script setup lang="ts">
import { computed } from 'vue'
import type { ChannelConfig, ChannelStats, ProtocolType } from '@/types'
import { BAUD_RATES, MIN_BUFFER_SIZE, MAX_BUFFER_SIZE, PROTOCOL_OPTIONS } from '@/types'
import ChannelItem from './ChannelItem.vue'

const props = defineProps<{
  baudRate: number
  bufferSize: number
  protocol: ProtocolType
  channels: ChannelConfig[]
  channelCount: number
  getChannelStats: (channelIndex: number) => ChannelStats | null
}>()

const emit = defineEmits<{
  'update:baudRate': [value: number]
  'update:bufferSize': [value: number]
  'update:protocol': [value: ProtocolType]
  'updateChannel': [id: number, updates: Partial<ChannelConfig>]
  'toggleVisibility': [id: number]
}>()

// 显示的通道数量
const displayChannels = computed(() => {
  return props.channels.slice(0, props.channelCount)
})
</script>

<template>
  <aside class="w-72 bg-gray-800 border-r border-gray-700 flex flex-col overflow-hidden">
    <!-- 连接配置 -->
    <div class="p-4 border-b border-gray-700">
      <h2 class="text-sm font-semibold text-gray-400 mb-3">连接配置</h2>

      <!-- 波特率 -->
      <div class="mb-3">
        <label class="block text-xs text-gray-500 mb-1">波特率</label>
        <div class="relative">
          <input
            type="number"
            :value="baudRate"
            list="baudRateList"
            min="300"
            max="4000000"
            class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
            @change="emit('update:baudRate', Math.max(300, Number(($event.target as HTMLInputElement).value) || 115200))"
          />
          <datalist id="baudRateList">
            <option v-for="rate in BAUD_RATES" :key="rate" :value="rate">{{ rate }}</option>
          </datalist>
        </div>
        <div class="text-xs text-gray-600 mt-1">常用: 9600, 115200, 921600</div>
      </div>

      <!-- 协议选择 -->
      <div class="mb-3">
        <label class="block text-xs text-gray-500 mb-1">协议类型</label>
        <select
          :value="protocol"
          class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
          @change="emit('update:protocol', ($event.target as HTMLSelectElement).value as ProtocolType)"
        >
          <option v-for="opt in PROTOCOL_OPTIONS" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
        <div class="text-xs text-gray-600 mt-1">
          {{ PROTOCOL_OPTIONS.find(o => o.value === protocol)?.description }}
        </div>
      </div>

      <!-- 缓冲区大小 -->
      <div>
        <label class="block text-xs text-gray-500 mb-1">
          缓冲区大小 ({{ MIN_BUFFER_SIZE.toLocaleString() }} - {{ MAX_BUFFER_SIZE.toLocaleString() }})
        </label>
        <input
          type="number"
          :value="bufferSize"
          :min="MIN_BUFFER_SIZE"
          :max="MAX_BUFFER_SIZE"
          step="1000"
          class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
          @change="emit('update:bufferSize', Math.max(MIN_BUFFER_SIZE, Math.min(MAX_BUFFER_SIZE, Number(($event.target as HTMLInputElement).value))))"
        />
      </div>
    </div>

    <!-- 通道列表 -->
    <div class="flex-1 overflow-y-auto p-4">
      <h2 class="text-sm font-semibold text-gray-400 mb-3">
        通道 ({{ channelCount }})
      </h2>

      <div v-if="channelCount === 0" class="text-sm text-gray-500 text-center py-4">
        等待数据...
      </div>

      <div v-else class="space-y-2">
        <ChannelItem
          v-for="channel in displayChannels"
          :key="channel.id"
          :channel="channel"
          :stats="getChannelStats(channel.id)"
          @update="(updates) => emit('updateChannel', channel.id, updates)"
          @toggle-visibility="emit('toggleVisibility', channel.id)"
        />
      </div>
    </div>
  </aside>
</template>
