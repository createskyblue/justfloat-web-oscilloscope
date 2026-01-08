<script setup lang="ts">
import { ref, shallowRef, watch, onMounted, onUnmounted, computed } from 'vue'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { ChannelConfig, SelectionStats } from '@/types'
import { CHANNEL_COLORS } from '@/types'
import { formatNumber } from '@/utils/helpers'

const props = defineProps<{
  data: any
  dataVersion: number
  channels: ChannelConfig[]
  channelCount: number
  sampleRate: number
  getChartData: () => (Float64Array | number[])[] | null
  getChartDataInRange: (start: number, end: number) => (Float64Array | number[])[] | null
  getSelectionStats: (start: number, end: number) => SelectionStats | null
  totalPoints: number
}>()

const emit = defineEmits<{
  'selection-change': [stats: SelectionStats | null]
}>()

const chartContainer = ref<HTMLDivElement | null>(null)
const chart = shallowRef<uPlot | null>(null)

// 选区状态
const selectionStats = ref<SelectionStats | null>(null)
const isZoomed = ref(false)
const zoomRange = ref<{ start: number; end: number } | null>(null)

// 模态框拖动状态
const panelRef = ref<HTMLDivElement | null>(null)
const panelPosition = ref({ x: 8, y: 8 }) // 默认左上角
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
  if (!isDragging.value || !chartContainer.value) return
  const containerRect = chartContainer.value.getBoundingClientRect()
  const panelRect = panelRef.value?.getBoundingClientRect()
  if (!panelRect) return

  let newX = e.clientX - containerRect.left - dragOffset.value.x
  let newY = e.clientY - containerRect.top - dragOffset.value.y

  // 限制在容器内
  newX = Math.max(0, Math.min(newX, containerRect.width - panelRect.width))
  newY = Math.max(0, Math.min(newY, containerRect.height - panelRect.height))

  panelPosition.value = { x: newX, y: newY }
}

// 停止拖动
const stopDrag = () => {
  isDragging.value = false
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', stopDrag)
}

// 刷新相关
let rafId: number | null = null
let lastUpdateTime = 0
let isUpdating = false

// 根据数据量调整刷新间隔
const adjustedInterval = computed(() => {
  const points = props.totalPoints
  if (points > 500000) return 500
  if (points > 200000) return 200
  if (points > 100000) return 100
  if (points > 50000) return 50
  return 32
})

// 创建图表配置
const createOptions = (width: number, height: number): uPlot.Options => {
  const series: uPlot.Series[] = [
    { label: '索引' } // X 轴
  ]

  // 添加通道系列
  for (let i = 0; i < Math.max(props.channelCount, 1); i++) {
    const channel = props.channels[i]
    const color = channel?.color || CHANNEL_COLORS[i % CHANNEL_COLORS.length]
    const visible = channel?.visible ?? true

    series.push({
      label: channel?.name || `通道 ${i + 1}`,
      stroke: color,
      width: 1.5,
      show: visible,
      spanGaps: true
    })
  }

  return {
    width,
    height,
    series,
    scales: {
      x: {
        time: false
      },
      y: {
        auto: true
      }
    },
    axes: [
      {
        stroke: '#888',
        grid: { stroke: 'rgba(255,255,255,0.1)', width: 1 },
        ticks: { stroke: '#666', width: 1 },
        font: '11px system-ui',
        labelFont: '12px system-ui'
      },
      {
        stroke: '#888',
        grid: { stroke: 'rgba(255,255,255,0.1)', width: 1 },
        ticks: { stroke: '#666', width: 1 },
        font: '11px system-ui',
        labelFont: '12px system-ui'
      }
    ],
    cursor: {
      show: true,
      drag: {
        x: true,
        y: true,
        setScale: false // 禁用自动设置scale，我们手动处理
      },
      focus: {
        prox: 30
      },
      points: {
        size: 6,
        fill: (u, i) => u.series[i].stroke as string
      }
    },
    select: {
      show: true,
      left: 0,
      top: 0,
      width: 0,
      height: 0
    },
    legend: {
      show: true
    },
    hooks: {
      setSelect: [
        (u) => {
          const left = u.select.left
          const width = u.select.width

          if (width > 10) {
            // 有效的框选
            const startX = u.posToVal(left, 'x')
            const endX = u.posToVal(left + width, 'x')
            const startIdx = Math.max(0, Math.floor(startX))
            const endIdx = Math.min(props.totalPoints - 1, Math.ceil(endX))

            if (endIdx > startIdx) {
              // 计算选区统计
              const stats = props.getSelectionStats(startIdx, endIdx)
              selectionStats.value = stats
              emit('selection-change', stats)

              // 保存缩放范围
              zoomRange.value = { start: startIdx, end: endIdx }
              isZoomed.value = true
            }
          }

          // 清除选择框
          u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false)
        }
      ]
    }
  }
}

// 初始化图表
const initChart = () => {
  if (!chartContainer.value) return

  const rect = chartContainer.value.getBoundingClientRect()
  const width = rect.width || 800
  const height = rect.height || 400

  // 初始空数据
  const initialData: uPlot.AlignedData = [[0]]
  for (let i = 0; i < Math.max(props.channelCount, 1); i++) {
    initialData.push([0])
  }

  const options = createOptions(width, height)
  chart.value = new uPlot(options, initialData, chartContainer.value)
}

// 更新图表数据
const updateChart = () => {
  if (!chart.value || isUpdating) {
    rafId = requestAnimationFrame(updateChart)
    return
  }

  const now = performance.now()
  if (now - lastUpdateTime < adjustedInterval.value) {
    rafId = requestAnimationFrame(updateChart)
    return
  }
  lastUpdateTime = now
  isUpdating = true

  try {
    let chartData: (Float64Array | number[])[] | null

    if (isZoomed.value && zoomRange.value) {
      // 显示缩放范围内的数据
      chartData = props.getChartDataInRange(zoomRange.value.start, zoomRange.value.end)
    } else {
      chartData = props.getChartData()
    }

    if (!chartData || chartData.length === 0) {
      rafId = requestAnimationFrame(updateChart)
      isUpdating = false
      return
    }

    // 检查系列数量是否匹配
    const expectedSeries = props.channelCount + 1
    if (chart.value.series.length !== expectedSeries) {
      destroyChart()
      initChart()
      rafId = requestAnimationFrame(updateChart)
      isUpdating = false
      return
    }

    // 更新通道可见性
    props.channels.forEach((channel, index) => {
      const seriesIndex = index + 1
      if (chart.value && chart.value.series[seriesIndex]) {
        const currentShow = chart.value.series[seriesIndex].show
        if (currentShow !== channel.visible) {
          chart.value.setSeries(seriesIndex, { show: channel.visible })
        }
      }
    })

    // 转换为 uPlot 格式
    const uplotData: uPlot.AlignedData = chartData.map(arr =>
      arr instanceof Float64Array ? Array.from(arr) : arr
    ) as uPlot.AlignedData

    chart.value.setData(uplotData)
  } finally {
    isUpdating = false
  }

  rafId = requestAnimationFrame(updateChart)
}

// 重置缩放
const resetZoom = () => {
  isZoomed.value = false
  zoomRange.value = null
  selectionStats.value = null
  panelPosition.value = { x: 8, y: 8 } // 重置位置
  emit('selection-change', null)
}

// 销毁图表
const destroyChart = () => {
  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  if (chart.value) {
    chart.value.destroy()
    chart.value = null
  }
}

// 调整大小
const handleResize = () => {
  if (!chartContainer.value || !chart.value) return

  const rect = chartContainer.value.getBoundingClientRect()
  chart.value.setSize({ width: rect.width, height: rect.height })
}

// 监听通道数变化
watch(() => props.channelCount, (newCount, oldCount) => {
  if (newCount !== oldCount && newCount > 0) {
    destroyChart()
    initChart()
    rafId = requestAnimationFrame(updateChart)
  }
})

// 生命周期
onMounted(() => {
  initChart()
  rafId = requestAnimationFrame(updateChart)

  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  destroyChart()
  window.removeEventListener('resize', handleResize)
  // 确保清理拖动事件
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', stopDrag)
})

// 暴露方法给父组件
defineExpose({
  resetZoom
})
</script>

<template>
  <div class="w-full h-full bg-gray-800 rounded-lg overflow-hidden relative">
    <!-- 图表容器 -->
    <div
      ref="chartContainer"
      class="w-full h-full"
    ></div>

    <!-- 工具栏 -->
    <div class="absolute top-2 right-2 flex gap-2 z-10">
      <!-- 缩放状态指示 -->
      <div
        v-if="isZoomed"
        class="bg-blue-600 text-white text-xs px-2 py-1 rounded flex items-center gap-2"
      >
        <span>已缩放: {{ zoomRange?.start }} - {{ zoomRange?.end }}</span>
        <button
          class="hover:bg-blue-500 rounded px-1"
          @click="resetZoom"
          title="重置缩放"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      <!-- 数据量提示 -->
      <div
        v-if="totalPoints > 100000"
        class="bg-yellow-600 text-white text-xs px-2 py-1 rounded"
        title="大数据量模式：已启用智能降采样"
      >
        {{ (totalPoints / 1000).toFixed(0) }}K 点
      </div>
    </div>

    <!-- 选区统计面板 - 可拖动，垂直布局 -->
    <div
      v-if="selectionStats"
      ref="panelRef"
      class="absolute bg-gray-900/95 backdrop-blur rounded-lg p-3 z-10 border border-gray-700 max-h-[80%] overflow-y-auto shadow-xl"
      :class="{ 'cursor-grabbing': isDragging }"
      :style="{
        left: panelPosition.x + 'px',
        top: panelPosition.y + 'px',
        minWidth: '200px',
        maxWidth: '280px'
      }"
    >
      <!-- 拖动手柄 -->
      <div
        class="flex items-center justify-between mb-2 cursor-grab select-none"
        :class="{ 'cursor-grabbing': isDragging }"
        @mousedown="startDrag"
      >
        <div class="flex items-center gap-2">
          <svg class="w-4 h-4 text-gray-500" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM14 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM14 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0z"/>
          </svg>
          <h3 class="text-sm font-semibold text-white">选区数据分析</h3>
        </div>
        <button
          class="text-gray-400 hover:text-white p-1"
          @click.stop="resetZoom"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- 基本信息 - 紧凑布局 -->
      <div class="grid grid-cols-2 gap-2 mb-3 text-xs">
        <div>
          <span class="text-gray-500">采样点</span>
          <div class="text-white font-mono">{{ selectionStats.pointCount?.toLocaleString() }}</div>
        </div>
        <div>
          <span class="text-gray-500">时长</span>
          <div class="text-white font-mono">{{ formatNumber(selectionStats.duration, 1) }}ms</div>
        </div>
        <div>
          <span class="text-gray-500">采样率</span>
          <div class="text-white font-mono">{{ formatNumber(selectionStats.frequency, 0) }}Hz</div>
        </div>
        <div>
          <span class="text-gray-500">范围</span>
          <div class="text-white font-mono text-xs">{{ selectionStats.startIndex }}-{{ selectionStats.endIndex }}</div>
        </div>
      </div>

      <!-- 通道统计 - 垂直堆叠 -->
      <div class="border-t border-gray-700 pt-2 space-y-2">
        <div
          v-for="ch in selectionStats.channels"
          :key="ch.id"
          class="bg-gray-800 rounded p-2"
        >
          <div class="flex items-center gap-1.5 mb-1.5">
            <span
              class="w-2 h-2 rounded-full flex-shrink-0"
              :style="{ backgroundColor: channels[ch.id]?.color || CHANNEL_COLORS[ch.id % CHANNEL_COLORS.length] }"
            ></span>
            <span class="text-xs text-gray-300 font-medium truncate">
              {{ channels[ch.id]?.name || `通道 ${ch.id + 1}` }}
            </span>
          </div>
          <div class="grid grid-cols-3 gap-2 text-xs">
            <div>
              <div class="text-gray-600">最小</div>
              <div class="text-green-400 font-mono">{{ formatNumber(ch.min, 2) }}</div>
            </div>
            <div>
              <div class="text-gray-600">最大</div>
              <div class="text-red-400 font-mono">{{ formatNumber(ch.max, 2) }}</div>
            </div>
            <div>
              <div class="text-gray-600">平均</div>
              <div class="text-blue-400 font-mono">{{ formatNumber(ch.avg, 2) }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 无数据提示 -->
    <div
      v-if="totalPoints === 0"
      class="absolute inset-0 flex items-center justify-center pointer-events-none"
    >
      <div class="text-gray-500 text-center">
        <svg class="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        <p>等待数据...</p>
        <p class="text-sm mt-2">请连接设备或导入数据文件</p>
        <p class="text-xs mt-3 text-gray-600">提示: 框选图表区域可进行缩放和数据分析</p>
      </div>
    </div>

    <!-- 操作提示 -->
    <div
      v-if="totalPoints > 0 && !selectionStats"
      class="absolute bottom-2 left-2 text-xs text-gray-500"
    >
      拖拽框选区域进行缩放和数据分析
    </div>
  </div>
</template>

<style scoped>
.uplot {
  width: 100% !important;
}

:deep(.u-wrap) {
  background: #1f2937;
}

:deep(.u-legend) {
  font-size: 12px;
  padding: 8px;
  background: rgba(31, 41, 55, 0.9);
  border-radius: 4px;
}

:deep(.u-legend th) {
  font-weight: normal;
  color: #9ca3af;
}

:deep(.u-legend td) {
  color: #e5e7eb;
}

:deep(.u-cursor-x),
:deep(.u-cursor-y) {
  border-color: rgba(255, 255, 255, 0.3);
}

:deep(.u-select) {
  background: rgba(59, 130, 246, 0.2) !important;
  border: 1px solid rgba(59, 130, 246, 0.5) !important;
}
</style>
