import { ref, watch } from 'vue'
import type { AppConfig } from '@/types'
import { DEFAULT_CONFIG } from '@/types'

const STORAGE_KEY = 'justfloat-oscilloscope-config'

export function useStorage() {
  // 加载配置
  const loadConfig = (): AppConfig => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const config = JSON.parse(stored) as AppConfig
        return {
          ...DEFAULT_CONFIG,
          ...config,
          // 确保 bufferSize 不小于最小值
          bufferSize: Math.max(1000, config.bufferSize || DEFAULT_CONFIG.bufferSize)
        }
      }
    } catch (error) {
      console.error('加载配置失败:', error)
    }
    return { ...DEFAULT_CONFIG }
  }

  // 保存配置
  const saveConfig = (config: AppConfig) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    } catch (error) {
      console.error('保存配置失败:', error)
    }
  }

  // 清除配置
  const clearConfig = () => {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch (error) {
      console.error('清除配置失败:', error)
    }
  }

  // 创建响应式配置
  const createReactiveConfig = () => {
    const config = ref(loadConfig())

    // 监听变化自动保存
    watch(config, (newConfig) => {
      saveConfig(newConfig)
    }, { deep: true })

    return config
  }

  return {
    loadConfig,
    saveConfig,
    clearConfig,
    createReactiveConfig
  }
}
