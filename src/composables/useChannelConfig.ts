import { ref } from 'vue'
import type { ChannelConfig } from '@/types'
import { CHANNEL_COLORS } from '@/types'

export function useChannelConfig() {
  const channels = ref<ChannelConfig[]>([])

  // 创建默认通道配置
  const createDefaultChannel = (id: number): ChannelConfig => ({
    id,
    name: `通道 ${id + 1}`,
    unit: '',
    coefficient: 1,
    visible: true,
    color: CHANNEL_COLORS[id % CHANNEL_COLORS.length]
  })

  // 确保有足够的通道配置
  const ensureChannels = (count: number) => {
    if (count <= 0) return

    const currentChannels = channels.value

    if (currentChannels.length < count) {
      // 添加新通道
      const newChannels = [...currentChannels]
      for (let i = currentChannels.length; i < count; i++) {
        newChannels.push(createDefaultChannel(i))
      }
      channels.value = newChannels
    } else if (currentChannels.length > count) {
      // 保留现有配置，只是不显示多余的
      // 不裁剪，以保留用户配置
    }
  }

  // 更新通道配置
  const updateChannel = (id: number, updates: Partial<ChannelConfig>) => {
    const index = channels.value.findIndex(ch => ch.id === id)
    if (index !== -1) {
      const newChannels = [...channels.value]
      newChannels[index] = { ...newChannels[index], ...updates }
      channels.value = newChannels
    }
  }

  // 切换通道可见性
  const toggleVisibility = (id: number) => {
    updateChannel(id, { visible: !channels.value.find(ch => ch.id === id)?.visible })
  }

  // 设置通道名称
  const setName = (id: number, name: string) => {
    updateChannel(id, { name })
  }

  // 设置通道单位
  const setUnit = (id: number, unit: string) => {
    updateChannel(id, { unit })
  }

  // 设置通道系数
  const setCoefficient = (id: number, coefficient: number) => {
    updateChannel(id, { coefficient })
  }

  // 获取可见通道
  const getVisibleChannels = () => {
    return channels.value.filter(ch => ch.visible)
  }

  // 获取通道颜色数组
  const getColors = () => {
    return channels.value.map(ch => ch.color)
  }

  // 获取通道系数数组
  const getCoefficients = () => {
    return channels.value.map(ch => ch.coefficient)
  }

  // 重置所有通道配置
  const resetChannels = () => {
    channels.value = channels.value.map((_, index) => createDefaultChannel(index))
  }

  // 加载通道配置
  const loadChannels = (configs: ChannelConfig[]) => {
    channels.value = configs.map((config, index) => ({
      ...createDefaultChannel(index),
      ...config,
      id: index // 确保 id 正确
    }))
  }

  return {
    channels,
    ensureChannels,
    updateChannel,
    toggleVisibility,
    setName,
    setUnit,
    setCoefficient,
    getVisibleChannels,
    getColors,
    getCoefficients,
    resetChannels,
    loadChannels
  }
}
