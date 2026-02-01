<script setup lang="ts">
import { ref, shallowRef, watch, onMounted, onUnmounted, computed, nextTick } from 'vue'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { ChannelConfig, SelectionStats } from '@/types'
import { CHANNEL_COLORS } from '@/types'

const props = defineProps<{
  channels: ChannelConfig[]
  channelCount: number
  sampleRate: number
  totalPoints: number
  isDark: boolean
  // 数据接口 - 使用函数形式进行惰性计算
  getChartData: () => (Float64Array | number[])[] | null
  getFullChartData: () => (Float64Array | number[])[] | null
}>()

const emit = defineEmits<{
  'selection-change': [stats: SelectionStats | null]
  'cursor-values': [values: number[] | null, index: number | null]
}>()

const chartContainer = ref<HTMLDivElement | null>(null)
const chart = shallowRef<uPlot | null>(null)

// Minimap 相关
const minimapContainer = ref<HTMLDivElement | null>(null)
const minimap = shallowRef<uPlot | null>(null)
const minimapViewport = ref<HTMLDivElement | null>(null)
const mainChartYAxisWidth = ref(0) // 主图Y轴宽度
const isDraggingViewport = ref(false)
const viewportDragStartX = ref(0)
const viewportDragStartLeft = ref(0)
// 边框拖动状态
const edgeDragMode = ref<'left' | 'right' | null>(null)
const edgeDragStartX = ref(0)
const edgeDragStartLeft = ref(0)
const edgeDragStartWidth = ref(0)

// 选区状态
const selectionStats = ref<SelectionStats | null>(null)
const isZoomed = ref(false)
const zoomRange = ref<{ start: number; end: number } | null>(null)
// 缩放历史栈
const zoomHistory = ref<{ start: number; end: number }[]>([])

// 光标值状态
const cursorIndex = ref<number | null>(null)

// 惰性获取数据（使用 computed 自动缓存）
const chartData = computed(() => props.getChartData())
const fullData = computed(() => props.getFullChartData())

// 统计计算缓存（避免重复计算）
let cachedStatsKey = ''
let cachedStatsResult: SelectionStats | null = null

// 计算选区统计数据的辅助函数
const calculateSelectionStats = (startIdx: number, endIdx: number): SelectionStats | null => {
  // 使用 fullData 而不是 chartData，因为 startIdx/endIdx 是基于全量数据的索引
  if (!fullData.value || fullData.value.length === 0) return null

  const data = fullData.value
  const xData = data[0] as number[]
  if (!xData || xData.length === 0) return null

  const startIndex = Math.max(0, Math.floor(startIdx))
  const endIndex = Math.min(xData.length - 1, Math.floor(endIdx))

  if (startIndex >= endIndex) return null

  // 生成缓存键（包含选区范围和所有通道的系数）
  const key = `${startIndex}-${endIndex}-${props.channels.map(ch => ch.coefficient).join(',')}`

  // 检查缓存
  if (key === cachedStatsKey) {
    return cachedStatsResult
  }

  const pointCount = endIndex - startIndex + 1
  const startValue = xData[startIndex]
  const endValue = xData[endIndex]
  const duration = endValue - startValue
  const frequency = pointCount / duration * props.sampleRate

  const channels = props.channels.slice(0, props.channelCount).map((channel, idx) => {
    const seriesIdx = idx + 1
    const seriesData = data[seriesIdx] as number[]
    if (!seriesData) return { id: idx, min: 0, max: 0, avg: 0 }

    let sum = 0
    let min = Infinity
    let max = -Infinity

    for (let i = startIndex; i <= endIndex; i++) {
      const val = seriesData[i] * channel.coefficient
      sum += val
      if (val < min) min = val
      if (val > max) max = val
    }

    return {
      id: idx,
      min,
      max,
      avg: sum / pointCount
    }
  }).filter(ch => ch !== undefined) as SelectionStats['channels']

  const result: SelectionStats = {
    startIndex,
    endIndex,
    pointCount,
    duration,
    frequency,
    channels
  }

  // 更新缓存
  cachedStatsKey = key
  cachedStatsResult = result

  return result
}

// 获取范围内数据的辅助函数
const getDataInRange = (startIdx: number, endIdx: number): (Float64Array | number[])[] | null => {
  if (!fullData.value || fullData.value.length === 0) return null

  const result: (Float64Array | number[])[] = []
  const start = Math.max(0, Math.floor(startIdx))
  const end = Math.min(fullData.value[0].length - 1, Math.floor(endIdx))

  // 边界检查：如果范围无效，返回 null
  if (start >= end || start < 0 || end >= fullData.value[0].length) {
    return null
  }

  for (let i = 0; i < fullData.value.length; i++) {
    const series = fullData.value[i]
    if (Array.isArray(series)) {
      result.push(series.slice(start, end + 1))
    } else {
      // TypedArray
      result.push(series.subarray(start, end + 1))
    }
  }

  return result
}

// 刷新相关
let rafId: number | null = null
let lastUpdateTime = 0
let isUpdating = false
let resizeObserver: ResizeObserver | null = null
let resizeTimeout: ReturnType<typeof setTimeout> | null = null

// 根据数据量和采样率调整刷新间隔（目标：在性能和流畅度之间平衡）
const adjustedInterval = computed(() => {
  const points = props.totalPoints
  const rate = props.sampleRate

  // 基础刷新间隔
  const minInterval = 33 // 约30fps

  // 大数据量时适当降低刷新率以优先保证性能
  if (rate > 7500 && points > 500000) {
    return 60 // 降低到约16fps，优先性能
  }

  if (points > 200000) return 50  // 约20fps
  if (points > 100000) return 50  // 100K数据也降到20fps，优先性能
  if (points > 50000) return 40   // 约25fps
  return minInterval  // 小数据量保持30fps
})

// 创建图表配置
const createOptions = (width: number, height: number): uPlot.Options => {
  const series: uPlot.Series[] = [
    { label: '索引', show: false } // X 轴，不在图例中显示
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
        labelFont: '12px system-ui',
        size: 70 // Y轴宽度，确保能显示至少7个数字
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
      show: false
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
              // 如果当前已缩放，将当前状态推入历史栈
              if (isZoomed.value && zoomRange.value) {
                zoomHistory.value.push({ ...zoomRange.value })
              }

              // 计算选区统计
              const stats = calculateSelectionStats(startIdx, endIdx)
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

// 创建 Minimap 配置（简化的预览图）
const createMinimapOptions = (width: number, height: number): uPlot.Options => {
  const series: uPlot.Series[] = [
    { label: '索引', show: false } // X 轴，不在图例中显示
  ]

  // 添加通道系列（只显示可见的通道）
  for (let i = 0; i < Math.max(props.channelCount, 1); i++) {
    const channel = props.channels[i]
    const color = channel?.color || CHANNEL_COLORS[i % CHANNEL_COLORS.length]
    const visible = channel?.visible ?? true

    if (visible) {
      series.push({
        label: channel?.name || `通道 ${i + 1}`,
        stroke: color,
        width: 1,
        show: true,
        spanGaps: true,
        fill: `${color}20` // 半透明填充
      })
    }
  }

  const isDarkTheme = props.isDark
  const axesColor = isDarkTheme ? '#666' : '#ccc'
  const gridColor = isDarkTheme ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'

  return {
    width,
    height,
    series,
    scales: {
      x: { time: false },
      y: { auto: true }
    },
    axes: [
      {
        stroke: axesColor,
        grid: { show: false },
        ticks: { show: false },
        size: 0
      },
      {
        stroke: axesColor,
        grid: { stroke: gridColor, width: 1 },
        ticks: { show: false },
        size: 0
      }
    ],
    cursor: { show: false },
    select: {
      show: false,
      left: 0,
      top: 0,
      width: 0,
      height: 0
    },
    legend: { show: false },
    hooks: {}
  }
}

// 初始化图表
const initChart = () => {
  if (!chartContainer.value) return

  const rect = chartContainer.value.getBoundingClientRect()
  const width = rect.width || 800
  // 减去 Minimap 的高度 (70px) + 额外间距 (5px)
  const height = Math.max(100, (rect.height || 400) - 75)

  // 初始空数据
  const initialData: uPlot.AlignedData = [[0]]
  for (let i = 0; i < Math.max(props.channelCount, 1); i++) {
    initialData.push([0])
  }

  const options = createOptions(width, height)
  chart.value = new uPlot(options, initialData, chartContainer.value)

  // 获取主图Y轴宽度，用于对齐Minimap
  nextTick(() => {
    if (chart.value && chart.value.axes[1]) {
      const axisSize = chart.value.axes[1].size
      mainChartYAxisWidth.value = typeof axisSize === 'number' ? axisSize : 40
    }
  })

  // 初始化 Minimap
  initMinimap()
}

// 初始化 Minimap
const initMinimap = (sync = false) => {
  const doInit = () => {
    if (!minimapContainer.value || props.totalPoints === 0) return

    const rect = minimapContainer.value.getBoundingClientRect()
    // 使用容器的完整宽度
    const width = Math.max(100, rect.width || 800)
    const height = 60 // 固定高度

    // 如果宽度还是无效，再延迟一帧
    if (width < 100) {
      setTimeout(() => initMinimap(sync), 50)
      return
    }

  // 获取所有数据的降采样版本用于预览
  const data = fullData.value
  if (!data || data[0].length === 0) return

  // 对数据进行降采样以适应小尺寸
  const maxPoints = width * 2 // 每2个像素一个点
  const xData = data[0]
  const step = Math.max(1, Math.ceil(xData.length / maxPoints))
  const pointCount = Math.ceil(xData.length / step)

  // 使用 TypedArray 预分配
  const downsampledData: (Float64Array | number[])[] = [
    new Float64Array(pointCount)
  ]
  for (let ch = 1; ch < data.length; ch++) {
    downsampledData.push(new Float64Array(pointCount))
  }

  // 使用索引赋值代替 push
  let outIdx = 0
  for (let i = 0; i < xData.length; i += step) {
    downsampledData[0][outIdx] = xData[i] as number
    for (let ch = 1; ch < data.length; ch++) {
      const channelData = data[ch] as number[]
      downsampledData[ch][outIdx] = channelData[i]
    }
    outIdx++
  }

  const options = createMinimapOptions(width, height)
    minimap.value = new uPlot(options, downsampledData as uPlot.AlignedData, minimapContainer.value)

    // 更新视口位置
    updateMinimapViewport()
  }

  // 如果需要同步执行（如数据重新开始时），直接执行
  // 否则延迟一帧确保 DOM 布局完成
  if (sync) {
    doInit()
  } else {
    requestAnimationFrame(doInit)
  }
}

// 更新 Minimap 视口位置
const updateMinimapViewport = () => {
  if (!minimapViewport.value || !minimap.value || props.totalPoints === 0) return

  const total = props.totalPoints
  let startPct = 0
  let widthPct = 1

  if (isZoomed.value && zoomRange.value) {
    const range = zoomRange.value.end - zoomRange.value.start
    startPct = zoomRange.value.start / total
    widthPct = range / total
  }

  // 确保百分比在合理范围内（避免浮点数精度问题）
  startPct = Math.max(0, Math.min(1, startPct))
  widthPct = Math.max(0.01, Math.min(1 - startPct, widthPct))

  minimapViewport.value.style.left = `${startPct * 100}%`
  minimapViewport.value.style.width = `${widthPct * 100}%`
}

// 视口拖动开始
const startViewportDrag = (e: MouseEvent) => {
  if (!minimapViewport.value || !minimapContainer.value) return
  isDraggingViewport.value = true
  viewportDragStartX.value = e.clientX
  viewportDragStartLeft.value = parseFloat(minimapViewport.value.style.left || '0')

  document.addEventListener('mousemove', onViewportDrag)
  document.addEventListener('mouseup', stopViewportDrag)
  e.preventDefault()
}

// 视口拖动中
const onViewportDrag = (e: MouseEvent) => {
  if (!isDraggingViewport.value || !minimapViewport.value || !minimapContainer.value || !minimap.value) return

  const containerRect = minimapContainer.value.getBoundingClientRect()
  const deltaX = e.clientX - viewportDragStartX.value
  // 视口现在在 minimapContainer 内部，直接使用容器宽度
  const usableWidth = containerRect.width
  const deltaXPct = (deltaX / usableWidth) * 100

  let newLeft = viewportDragStartLeft.value + deltaXPct
  const viewportWidth = parseFloat(minimapViewport.value.style.width || '100')

  // 限制在容器内
  newLeft = Math.max(0, Math.min(newLeft, 100 - viewportWidth))

  minimapViewport.value.style.left = `${newLeft}%`

  // 计算对应的缩放范围
  const total = props.totalPoints
  const startIdx = Math.floor((newLeft / 100) * total)
  const endIdx = Math.floor(((newLeft + viewportWidth) / 100) * total)

  if (endIdx > startIdx) {
    zoomRange.value = { start: startIdx, end: endIdx }
    isZoomed.value = true

    // 更新选区统计
    const stats = calculateSelectionStats(startIdx, endIdx)
    selectionStats.value = stats
    emit('selection-change', stats)
  }
}

// 停止视口拖动
const stopViewportDrag = () => {
  isDraggingViewport.value = false
  document.removeEventListener('mousemove', onViewportDrag)
  document.removeEventListener('mouseup', stopViewportDrag)
}

// 检测鼠标在视口边框的位置
const getCursorAtEdge = (e: MouseEvent): 'left' | 'right' | null => {
  if (!minimapViewport.value) return null
  const rect = minimapViewport.value.getBoundingClientRect()
  const x = e.clientX - rect.left
  const edgeThreshold = 6 // 边框检测阈值（像素）

  if (x <= edgeThreshold) return 'left'
  if (x >= rect.width - edgeThreshold) return 'right'
  return null
}

// 更新鼠标指针样式
const updateCursorStyle = (e: MouseEvent) => {
  if (!minimapViewport.value) return
  const edge = getCursorAtEdge(e)
  if (edge === 'left') {
    minimapViewport.value.style.cursor = 'w-resize'
  } else if (edge === 'right') {
    minimapViewport.value.style.cursor = 'e-resize'
  } else {
    minimapViewport.value.style.cursor = isDraggingViewport.value ? 'grabbing' : 'grab'
  }
}

// 左边框拖动开始
const startLeftEdgeDrag = (e: MouseEvent) => {
  if (!minimapViewport.value || !minimapContainer.value) return
  edgeDragMode.value = 'left'
  edgeDragStartX.value = e.clientX
  edgeDragStartLeft.value = parseFloat(minimapViewport.value.style.left || '0')
  edgeDragStartWidth.value = parseFloat(minimapViewport.value.style.width || '100')

  document.addEventListener('mousemove', onEdgeDrag)
  document.addEventListener('mouseup', stopEdgeDrag)
  e.preventDefault()
  e.stopPropagation()
}

// 右边框拖动开始
const startRightEdgeDrag = (e: MouseEvent) => {
  if (!minimapViewport.value || !minimapContainer.value) return
  edgeDragMode.value = 'right'
  edgeDragStartX.value = e.clientX
  edgeDragStartLeft.value = parseFloat(minimapViewport.value.style.left || '0')
  edgeDragStartWidth.value = parseFloat(minimapViewport.value.style.width || '100')

  document.addEventListener('mousemove', onEdgeDrag)
  document.addEventListener('mouseup', stopEdgeDrag)
  e.preventDefault()
  e.stopPropagation()
}

// 边框拖动中
const onEdgeDrag = (e: MouseEvent) => {
  if (!edgeDragMode.value || !minimapViewport.value || !minimapContainer.value || !minimap.value) return

  const containerRect = minimapContainer.value.getBoundingClientRect()
  const deltaX = e.clientX - edgeDragStartX.value
  // 视口现在在 minimapContainer 内部，直接使用容器宽度
  const usableWidth = containerRect.width
  const deltaXPct = (deltaX / usableWidth) * 100

  let newLeft = edgeDragStartLeft.value
  let newWidth = edgeDragStartWidth.value

  if (edgeDragMode.value === 'left') {
    // 拖动左边框：改变 left 和 width
    const maxDelta = edgeDragStartWidth.value - 2 // 最小宽度 2%
    const delta = Math.max(-edgeDragStartLeft.value, Math.min(deltaXPct, maxDelta))
    newLeft = edgeDragStartLeft.value + delta
    newWidth = edgeDragStartWidth.value - delta
  } else if (edgeDragMode.value === 'right') {
    // 拖动右边框：只改变 width
    const maxDelta = 100 - edgeDragStartLeft.value - edgeDragStartWidth.value
    const delta = Math.max(-edgeDragStartWidth.value + 2, Math.min(deltaXPct, maxDelta))
    newWidth = edgeDragStartWidth.value + delta
  }

  minimapViewport.value.style.left = `${newLeft}%`
  minimapViewport.value.style.width = `${newWidth}%`

  // 计算对应的缩放范围
  const total = props.totalPoints
  const startIdx = Math.floor((newLeft / 100) * total)
  const endIdx = Math.floor(((newLeft + newWidth) / 100) * total)

  if (endIdx > startIdx) {
    zoomRange.value = { start: startIdx, end: endIdx }
    isZoomed.value = true

    // 更新选区统计
    const stats = calculateSelectionStats(startIdx, endIdx)
    selectionStats.value = stats
    emit('selection-change', stats)
  }
}

// 停止边框拖动
const stopEdgeDrag = () => {
  edgeDragMode.value = null
  document.removeEventListener('mousemove', onEdgeDrag)
  document.removeEventListener('mouseup', stopEdgeDrag)
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
    let currentChartData: (Float64Array | number[])[] | null

    if (isZoomed.value && zoomRange.value) {
      // 显示缩放范围内的数据
      currentChartData = getDataInRange(zoomRange.value.start, zoomRange.value.end)
    } else {
      currentChartData = chartData.value
    }

    // 如果没有数据，显示空图表
    if (!currentChartData || currentChartData.length === 0 || currentChartData[0].length === 0) {
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
    let visibilityChanged = false
    props.channels.forEach((channel, index) => {
      const seriesIndex = index + 1
      if (chart.value && chart.value.series[seriesIndex]) {
        const currentShow = chart.value.series[seriesIndex].show
        if (currentShow !== channel.visible) {
          chart.value.setSeries(seriesIndex, { show: channel.visible })
          visibilityChanged = true
        }
      }
    })

    // 直接使用 Float64Array，uPlot 原生支持 TypedArray
    chart.value.setData(currentChartData as uPlot.AlignedData)

    // 同步更新 Minimap（与主图表使用同一个刷新循环，保证稳定性）
    // 如果通道可见性发生变化，需要重新初始化 minimap 以更新 series 配置
    if (visibilityChanged && minimap.value) {
      minimap.value.destroy()
      minimap.value = null
    }
    updateMinimapData()
    updateMinimapViewport()
  } finally {
    isUpdating = false
  }

  rafId = requestAnimationFrame(updateChart)
}

// 返回上一级缩放（使用历史栈）
const undoZoom = () => {
  // 如果有历史记录，恢复到上一个缩放状态
  if (zoomHistory.value.length > 0) {
    const prevZoom = zoomHistory.value.pop()
    if (prevZoom) {
      zoomRange.value = prevZoom
      // 重新计算选区统计
      const stats = calculateSelectionStats(prevZoom.start, prevZoom.end)
      selectionStats.value = stats
      emit('selection-change', stats)
      return
    }
  }

  // 没有历史记录，完全重置
  isZoomed.value = false
  zoomRange.value = null
  selectionStats.value = null
  emit('selection-change', null)
}

// 完全重置缩放（清空历史，直接回到原始大小）
const resetZoom = () => {
  isZoomed.value = false
  zoomRange.value = null
  zoomHistory.value = []
  selectionStats.value = null
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
  if (minimap.value) {
    minimap.value.destroy()
    minimap.value = null
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
    // 减去 Minimap 的高度 (70px) + 额外间距 (5px)
    const height = Math.max(100, Math.floor(rect.height) - 75)

    // 检查尺寸是否有效且有变化
    if (width > 0 && height > 0) {
      const currentSize = chart.value.width
      const currentHeight = chart.value.height

      // 只在尺寸真正变化时才更新
      if (Math.abs(currentSize - width) > 1 || Math.abs(currentHeight - height) > 1) {
        chart.value.setSize({ width, height })
      }
    }

    // 同时更新 Minimap 大小
    if (minimap.value && minimapContainer.value) {
      const minimapRect = minimapContainer.value.getBoundingClientRect()
      // 减去左右 margin (10px * 2)
      const minimapWidth = Math.max(100, Math.floor(minimapRect.width) - 20)
      minimap.value.setSize({ width: minimapWidth, height: 60 })
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
    // 重置缩放状态，避免旧缩放范围指向错误数据
    resetZoom()
    destroyChart()
    await initChart()
    rafId = requestAnimationFrame(updateChart)
  }
  // minimap 会在 updateChart 循环中通过 updateMinimapData() 自动重建
})

// 监听通道系数变化，更新选区统计（不使用 deep 监听避免频繁触发）
watch(() => props.channels.map(ch => ch.coefficient), () => {
  if (isZoomed.value && zoomRange.value) {
    // 重新计算选区统计
    const stats = calculateSelectionStats(zoomRange.value.start, zoomRange.value.end)
    selectionStats.value = stats
    emit('selection-change', stats)
  }
})

// 监听数据变化，当数据清空时清除 Minimap
watch(() => props.totalPoints, (newVal, oldVal) => {
  // 从有数据变为无数据，清除 Minimap 和缩放状态
  if (oldVal > 0 && newVal === 0) {
    if (minimap.value) {
      minimap.value.destroy()
      minimap.value = null
    }
    // 重置缩放状态
    resetZoom()
    return
  }

  // 只在数据量减少时检查是否需要重置缩放
  // 数据增加时，现有缩放范围仍然有效，无需重置
  if (oldVal > 0 && newVal > 0 && newVal < oldVal) {
    // 如果当前有缩放状态，检查缩放范围是否超出新的数据范围
    if (isZoomed.value && zoomRange.value) {
      const { end } = zoomRange.value
      // 如果缩放结束索引超出新数据范围，重置缩放
      if (end >= newVal) {
        resetZoom()
      }
    }
  }
})

// 监听数据源引用变化，重置缩放状态
watch([() => chartData.value, () => fullData.value], ([newChartData, newFullData]) => {
  // 如果数据源从 null 变为有数据，或数据长度发生变化，重置缩放
  if (newChartData && newFullData) {
    const fullLength = newFullData[0]?.length || 0

    // 如果当前有缩放状态，检查缩放范围是否仍然有效
    if (isZoomed.value && zoomRange.value) {
      const { start, end } = zoomRange.value
      // 如果缩放范围超出新数据范围，重置缩放
      if (start >= fullLength || end > fullLength) {
        resetZoom()
      }
    }
  }
})

// 更新 Minimap 数据
const updateMinimapData = () => {
  if (!minimapContainer.value || props.totalPoints === 0) return

  const data = fullData.value
  if (!data || data[0].length === 0) return

  // 如果 minimap 不存在，尝试重新初始化
  if (!minimap.value) {
    initMinimap(true)
    return
  }

  const rect = minimapContainer.value.getBoundingClientRect()
  // 使用容器的完整宽度
  const width = Math.max(100, rect.width || 800)

  // 对数据进行降采样
  const maxPoints = width * 2
  const xData = data[0]
  const step = Math.max(1, Math.ceil(xData.length / maxPoints))
  const pointCount = Math.ceil(xData.length / step)

  // 使用 TypedArray 预分配，避免频繁 push
  const downsampledData: (Float64Array | number[])[] = [
    new Float64Array(pointCount)
  ]
  for (let ch = 1; ch < data.length; ch++) {
    downsampledData.push(new Float64Array(pointCount))
  }

  // 使用索引赋值代替 push，性能更好
  let outIdx = 0
  for (let i = 0; i < xData.length; i += step) {
    downsampledData[0][outIdx] = xData[i] as number
    for (let ch = 1; ch < data.length; ch++) {
      const channelData = data[ch] as number[]
      downsampledData[ch][outIdx] = channelData[i]
    }
    outIdx++
  }

  // 更新 Minimap 数据
  minimap.value.setData(downsampledData as uPlot.AlignedData)
}

// 监听缩放范围变化，更新视口位置
watch([() => isZoomed.value, () => zoomRange.value], async () => {
  // 等待 DOM 更新完成
  await nextTick()
  updateMinimapViewport()
})

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
  // 清理视口拖动事件
  document.removeEventListener('mousemove', onViewportDrag)
  document.removeEventListener('mouseup', stopViewportDrag)
  // 清理边框拖动事件
  document.removeEventListener('mousemove', onEdgeDrag)
  document.removeEventListener('mouseup', stopEdgeDrag)
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
      @dblclick="isZoomed && undoZoom()"
      :title="isZoomed ? '双击返回上一级缩放' : ''"
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
          title="完全重置缩放"
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

    <!-- 选区统计面板插槽 -->
    <slot name="stats-panel" :stats="selectionStats" :reset-zoom="resetZoom">
      <!-- 默认为空，由父组件提供 -->
    </slot>

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
      style="bottom: 75px;"
    >
      拖拽框选区域进行缩放和数据分析
    </div>

    <!-- Minimap 全局预览条 -->
    <div
      v-if="totalPoints > 0"
      :class="['absolute bottom-0 left-0 right-0 z-20', isDark ? 'border-t border-gray-700' : 'border-t border-gray-300']"
      :style="{ height: '70px', background: isDark ? '#1f2937' : '#f9fafb' }"
    >
      <!-- Minimap 图表容器 -->
      <div
        ref="minimapContainer"
        class="relative"
        :style="{
          margin: '5px 10px 5px ' + (mainChartYAxisWidth + 10) + 'px',
          height: '60px'
        }"
      >
        <!-- 可拖动的视口窗口（放在 minimapContainer 内部，百分比相对于此容器计算） -->
        <div
          v-if="minimap && isZoomed"
          ref="minimapViewport"
          :class="['absolute top-0 bottom-0 border-2 z-10', isDark ? 'bg-blue-900/30 border-blue-500' : 'bg-blue-100/50 border-blue-500', { 'cursor-grabbing': isDraggingViewport || edgeDragMode }]"
          :style="{
            minWidth: '20px',
            cursor: 'grab'
          }"
          @mousemove="updateCursorStyle"
          @mousedown="(e) => {
            const edge = getCursorAtEdge(e)
            if (edge === 'left') startLeftEdgeDrag(e)
            else if (edge === 'right') startRightEdgeDrag(e)
            else startViewportDrag(e)
          }"
        >
          <!-- 左边框调整手柄 -->
          <div
            class="absolute top-0 bottom-0 w-1 cursor-w-resize hover:bg-white/50"
            style="left: -2px;"
          ></div>
          <!-- 右边框调整手柄 -->
          <div
            class="absolute top-0 bottom-0 w-1 cursor-e-resize hover:bg-white/50"
            style="right: -2px;"
          ></div>
        </div>
      </div>
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
