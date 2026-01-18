<script setup lang="ts">
import { ref, shallowRef, watch, onMounted, onUnmounted, computed, nextTick } from 'vue'
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
  isDark: boolean
}>()

const emit = defineEmits<{
  'selection-change': [stats: SelectionStats | null]
  'cursor-values': [values: number[] | null, index: number | null]
}>()

const chartContainer = ref<HTMLDivElement | null>(null)
const chart = shallowRef<uPlot | null>(null)

// 选区状态
const selectionStats = ref<SelectionStats | null>(null)
const isZoomed = ref(false)
const zoomRange = ref<{ start: number; end: number } | null>(null)

// 光标值状态
const cursorIndex = ref<number | null>(null)

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
let resizeObserver: ResizeObserver | null = null
let resizeTimeout: ReturnType<typeof setTimeout> | null = null

// 根据数据量和采样率调整刷新间隔
const adjustedInterval = computed(() => {
  const points = props.totalPoints
  const rate = props.sampleRate

  // 高采样率(>7.5K)时，固定1秒刷新一次以减少渲染压力
  if (rate > 7500) {
    return 1000
  }

  // 正常采样率时，根据数据量动态调整
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

  // 根据主题设置颜色
  const isDarkTheme = props.isDark
  const axesColor = isDarkTheme ? '#888' : '#333'
  const gridColor = isDarkTheme ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
  const ticksColor = isDarkTheme ? '#666' : '#888'

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
        stroke: axesColor,
        grid: { stroke: gridColor, width: 1 },
        ticks: { stroke: ticksColor, width: 1 },
        font: '11px system-ui',
        labelFont: '12px system-ui'
      },
      {
        stroke: axesColor,
        grid: { stroke: gridColor, width: 1 },
        ticks: { stroke: ticksColor, width: 1 },
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
      ],
      setCursor: [
        (u) => {
          const idx = u.cursor.idx
          if (idx != null && idx >= 0 && u.data && u.data[0] && idx < u.data[0].length) {
            // 获取各通道在当前光标位置的值
            const values: number[] = []
            for (let i = 1; i < u.data.length; i++) {
              values.push(u.data[i][idx] as number)
            }
            cursorIndex.value = Math.round(u.data[0][idx] as number)
            emit('cursor-values', values, cursorIndex.value)
          } else {
            cursorIndex.value = null
            emit('cursor-values', null, null)
          }
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

    // 如果没有数据，显示空图表
    if (!chartData || chartData.length === 0 || chartData[0].length === 0) {
      if (chart.value) {
        // 设置空数据以清除图表显示
        const emptyData: uPlot.AlignedData = [[]]
        for (let i = 0; i < props.channelCount; i++) {
          emptyData.push([])
        }
        chart.value.setData(emptyData)
      }
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

    // 直接使用 Float64Array，uPlot 原生支持 TypedArray
    chart.value.setData(chartData as uPlot.AlignedData)
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

// 调整大小（带防抖）
const handleResize = () => {
  if (resizeTimeout) {
    clearTimeout(resizeTimeout)
  }

  resizeTimeout = setTimeout(() => {
    if (!chartContainer.value || !chart.value) return

    const rect = chartContainer.value.getBoundingClientRect()
    const width = Math.max(100, Math.floor(rect.width))
    const height = Math.max(100, Math.floor(rect.height))

    // 检查尺寸是否有效且有变化
    if (width > 0 && height > 0) {
      const currentSize = chart.value.width
      const currentHeight = chart.value.height

      // 只在尺寸真正变化时才更新
      if (Math.abs(currentSize - width) > 1 || Math.abs(currentHeight - height) > 1) {
        chart.value.setSize({ width, height })
      }
    }
  }, 100) // 100ms 防抖
}

// 监听通道数变化
watch(() => props.channelCount, (newCount, oldCount) => {
  if (newCount !== oldCount && newCount > 0) {
    destroyChart()
    initChart()
    rafId = requestAnimationFrame(updateChart)
  }
})

// 监听主题变化
watch(() => props.isDark, async () => {
  // 主题变化时重新创建图表以应用新颜色
  if (chart.value) {
    destroyChart()
    await initChart()
    rafId = requestAnimationFrame(updateChart)
  }
})

// 监听通道配置变化（系数等），更新选区统计
watch(() => props.channels, () => {
  if (isZoomed.value && zoomRange.value) {
    // 重新计算选区统计
    const stats = props.getSelectionStats(zoomRange.value.start, zoomRange.value.end)
    selectionStats.value = stats
    emit('selection-change', stats)
  }
}, { deep: true })

// 生命周期
onMounted(() => {
  initChart()
  rafId = requestAnimationFrame(updateChart)

  // 使用 ResizeObserver 监听容器大小变化
  if (chartContainer.value) {
    resizeObserver = new ResizeObserver(() => {
      handleResize()
    })
    resizeObserver.observe(chartContainer.value)
  }

  // 同时监听窗口 resize 事件作为备用
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  destroyChart()

  // 清理 ResizeObserver
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }

  // 清理 resize timeout
  if (resizeTimeout) {
    clearTimeout(resizeTimeout)
    resizeTimeout = null
  }

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
  <div :class="['w-full h-full rounded-lg overflow-hidden relative', isDark ? 'bg-gray-800' : 'bg-white']">
    <!-- 图表容器 -->
    <div
      ref="chartContainer"
      :class="['w-full h-full', isDark ? 'dark-chart' : 'light-chart']"
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
        :class="['text-xs px-2 py-1 rounded', isDark ? 'bg-yellow-600 text-white' : 'bg-yellow-200 text-yellow-800']"
        title="大数据量模式：已启用智能降采样"
      >
        {{ (totalPoints / 1000).toFixed(0) }}K 点
      </div>
    </div>

    <!-- 选区统计面板 - 可拖动，垂直布局 -->
    <div
      v-if="selectionStats"
      ref="panelRef"
      :class="['absolute backdrop-blur rounded-lg p-3 z-10 border max-h-[80%] overflow-y-auto shadow-xl', isDark ? 'bg-gray-900/95 border-gray-700' : 'bg-white/95 border-gray-300', { 'cursor-grabbing': isDragging }]"
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
          <svg :class="['w-4 h-4', isDark ? 'text-gray-500' : 'text-gray-400']" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM14 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM14 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0z"/>
          </svg>
          <h3 :class="['text-sm font-semibold', isDark ? 'text-white' : 'text-gray-900']">选区数据分析</h3>
        </div>
        <button
          :class="['p-1', isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900']"
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
          <span :class="isDark ? 'text-gray-500' : 'text-gray-400'">采样点</span>
          <div :class="['font-mono', isDark ? 'text-white' : 'text-gray-900']">{{ selectionStats.pointCount?.toLocaleString() }}</div>
        </div>
        <div>
          <span :class="isDark ? 'text-gray-500' : 'text-gray-400'">时长</span>
          <div :class="['font-mono', isDark ? 'text-white' : 'text-gray-900']">{{ formatNumber(selectionStats.duration, 1) }}ms</div>
        </div>
        <div>
          <span :class="isDark ? 'text-gray-500' : 'text-gray-400'">采样率</span>
          <div :class="['font-mono', isDark ? 'text-white' : 'text-gray-900']">{{ formatNumber(selectionStats.frequency, 0) }}Hz</div>
        </div>
        <div>
          <span :class="isDark ? 'text-gray-500' : 'text-gray-400'">范围</span>
          <div :class="['font-mono text-xs', isDark ? 'text-white' : 'text-gray-900']">{{ selectionStats.startIndex }}-{{ selectionStats.endIndex }}</div>
        </div>
      </div>

      <!-- 通道统计 - 垂直堆叠 -->
      <div :class="['border-t pt-2 space-y-2', isDark ? 'border-gray-700' : 'border-gray-300']">
        <div
          v-for="ch in selectionStats.channels"
          :key="ch.id"
          :class="['rounded p-2', isDark ? 'bg-gray-800' : 'bg-gray-100']"
        >
          <div class="flex items-center gap-1.5 mb-1.5">
            <span
              class="w-2 h-2 rounded-full flex-shrink-0"
              :style="{ backgroundColor: channels[ch.id]?.color || CHANNEL_COLORS[ch.id % CHANNEL_COLORS.length] }"
            ></span>
            <span :class="['text-xs font-medium truncate', isDark ? 'text-gray-300' : 'text-gray-700']">
              {{ channels[ch.id]?.name || `通道 ${ch.id + 1}` }}
            </span>
          </div>
          <div class="grid grid-cols-3 gap-2 text-xs">
            <div>
              <div :class="isDark ? 'text-gray-600' : 'text-gray-400'">最小</div>
              <div class="text-green-400 font-mono">{{ formatNumber(ch.min) }}</div>
            </div>
            <div>
              <div :class="isDark ? 'text-gray-600' : 'text-gray-400'">最大</div>
              <div class="text-red-400 font-mono">{{ formatNumber(ch.max) }}</div>
            </div>
            <div>
              <div :class="isDark ? 'text-gray-600' : 'text-gray-400'">平均</div>
              <div class="text-blue-400 font-mono">{{ formatNumber(ch.avg) }}</div>
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
      <div :class="['text-center', isDark ? 'text-gray-500' : 'text-gray-400']">
        <svg class="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        <p>等待数据...</p>
        <p class="text-sm mt-2">请连接设备或导入数据文件</p>
        <p :class="['text-xs mt-3', isDark ? 'text-gray-600' : 'text-gray-500']">提示: 框选图表区域可进行缩放和数据分析</p>
      </div>
    </div>

    <!-- 操作提示 -->
    <div
      v-if="totalPoints > 0 && !selectionStats"
      :class="['absolute bottom-2 left-2 text-xs', isDark ? 'text-gray-500' : 'text-gray-400']"
    >
      拖拽框选区域进行缩放和数据分析
    </div>
  </div>
</template>

<style scoped>
.uplot {
  width: 100% !important;
}

/* 暗色模式样式 */
.dark-chart :deep(.u-wrap) {
  background: #1f2937 !important;
}

.dark-chart :deep(.u-legend) {
  font-size: 12px;
  padding: 8px;
  background: rgba(31, 41, 55, 0.9) !important;
  border-radius: 4px;
}

.dark-chart :deep(.u-legend th) {
  font-weight: normal;
  color: #9ca3af;
}

.dark-chart :deep(.u-legend td) {
  color: #e5e7eb;
}

.dark-chart :deep(.u-cursor-x),
.dark-chart :deep(.u-cursor-y) {
  border-color: rgba(255, 255, 255, 0.3) !important;
}

.dark-chart :deep(.u-select) {
  background: rgba(59, 130, 246, 0.2) !important;
  border: 1px solid rgba(59, 130, 246, 0.5) !important;
}

/* 亮色模式样式 */
.light-chart :deep(.u-wrap) {
  background: #ffffff !important;
}

.light-chart :deep(.u-legend) {
  font-size: 12px;
  padding: 8px;
  background: rgba(255, 255, 255, 0.9) !important;
  border-radius: 4px;
  border: 1px solid #e5e7eb;
}

.light-chart :deep(.u-legend th) {
  font-weight: normal;
  color: #6b7280;
}

.light-chart :deep(.u-legend td) {
  color: #374151;
}

.light-chart :deep(.u-cursor-x),
.light-chart :deep(.u-cursor-y) {
  border-color: rgba(0, 0, 0, 0.3) !important;
}

.light-chart :deep(.u-select) {
  background: rgba(59, 130, 246, 0.1) !important;
  border: 1px solid rgba(59, 130, 246, 0.3) !important;
}
</style>
