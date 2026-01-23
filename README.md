# Web 示波器：实时解析 JustFloat 与 FireWater 协议，支持串口（Web Serial）、蓝牙（Web Bluetooth）和 WebSocket 数据源

支持 8 通道、100kHz 实时刷新的 Web 示波器，专为解析 JustFloat 与 FireWater 二进制协议设计。无需安装软件，在浏览器中即可通过 USB 串口（Web Serial）、BLE 蓝牙（Web Bluetooth） 或 WebSocket 接入设备，实时捕获并可视化高频传感器或嵌入式系统数据。所有波形渲染与协议解析均在客户端完成，确保低延迟与数据隐私。适用于飞控调试、电机控制、多轴传感器分析等对速率和通道数有较高要求的场景。基于现代 Web 技术构建，兼容主流桌面及移动端浏览器，开源免费，即开即用。

An 8-channel Web oscilloscope with real-time 100 kHz waveform refresh, designed specifically for parsing JustFloat and FireWater binary protocols. This open-source tool runs entirely in the browser—no installation required—and supports three flexible data sources: USB serial (via Web Serial API), BLE devices (via Web Bluetooth API), and remote streams over WebSocket.

![JustFloat 数据解析](./img/PixPin_2026-01-08_09-17-04.png)
![JustFloat 1通道 100+KHz](./img/PixPin_2026-01-09_12-06-23.png)
![JustFloat 1通道 100+KHz 统计分析](./img/PixPin_2026-01-09_12-06-41.png)
![FireWater 数据解析](./img/PixPin_2026-01-09_04-00-32.png)

## 功能特性

- 通过串口或WebSocket连接设备并实时接收数据
- 解析JustFloat协议数据（协议格式：[float ch1, ..., float chN, 0x00, 0x00, 0x80, 0x7F]）
- 解析FireWater协议数据（文本格式：<any>:ch0,ch1,ch2,...,chN\n）
- 支持协议动态切换（JustFloat/FireWater）
- 支持连接方式切换（串口/WebSocket）
- 实时绘制多通道波形图（最多支持8种颜色区分通道）
- 支持数据导入/导出功能（JSON格式）
- 通道配置：可独立设置每个通道的名称、单位、系数和可见性
- 实时显示通道统计数据（最小值、最大值、平均值、当前值）
- 可配置的缓冲区大小（最小1000点，最大1000000点）
- 支持多种波特率（默认115200）
- 性能优化：JustFloat模式下 1个通道 100KHz 运行流畅！

## 连接方式

### 串口连接
- 使用Web Serial API与设备通信
- 适用于本地串口设备（USB转串口、Arduino、单片机等）
- 需要在浏览器中选择对应的串口设备

### WebSocket连接
- 通过WebSocket协议接收数据
- 适用于远程数据源或网络转发服务
- 支持文本和二进制数据格式
- 可配置WebSocket服务器地址（默认：ws://localhost:8080）

## 协议说明

### JustFloat协议
数据格式：[float ch1, ..., float chN, 0x00, 0x00, 0x80, 0x7F]

- 数据以4字节为单位的浮点数传输
- 以[0x00, 0x00, 0x80, 0x7F]作为帧同步字
- 解析器使用状态机逐字节解析数据

### FireWater协议
数据格式：[<any>:]ch0,ch1,ch2,...,chN\n

- 文本协议，逗号分隔的数值

更多FireWater协议信息请参考：[VOFA+ FireWater协议说明](https://www.vofa.plus/docs/learning/dataengines/firewater)

## 性能特点

- **高速率支持**：支持高达100KHz的速率
- **高效数据解析**：使用批处理机制提高解析效率
- **智能渲染**：根据数据量和速率动态调整刷新频率
- **内存管理**：自动限制缓冲区大小，避免内存溢出
- **响应式界面**：使用uPlot图表库实现高性能数据可视化

## 技术栈

- Vue 3 (Composition API)
- TypeScript
- uPlot (高性能图表渲染)
- Tailwind CSS (样式框架)
- Vite (构建工具)

## 安装和运行

1. 确保已安装Node.js环境

2. 克隆项目：
   ```bash
   git clone https://github.com/createskyblue/justfloat-web-oscilloscope
   ```

3. 进入项目目录并安装依赖：
   ```bash
   cd justfloat-web-oscilloscope
   npm install
   ```

4. 启动开发服务器：
   ```bash
   npm run dev
   ```

## 使用说明

1. 确保浏览器支持所需功能（Chrome/Edge推荐）
2. 连接设备到电脑或启动WebSocket数据服务
3. 打开应用，选择对应的协议类型（JustFloat或FireWater）
4. 选择连接方式：
   - 串口连接：点击"连接设备"按钮并选择对应的串口设备
   - WebSocket连接：输入WebSocket服务器地址，点击"连接"按钮
5. 根据需要调整波特率设置（串口连接时有效）
6. 实时查看设备发送的数据波形
7. 使用鼠标框选功能进行数据区域分析

## 功能操作

- **缩放功能**：在图表上拖拽鼠标创建选区，可以放大查看特定数据段
  - **缩放历史**：支持多级缩放历史记录，双击图表或点击右上角的返回按钮可返回上一级缩放状态
  - 连续框选会自动记录每次缩放的状态
  - 缩放状态指示器会显示当前历史记录的级数
  - 当没有历史记录时，双击会完全重置缩放
- **数据统计**：选区后会显示详细的统计数据（采样点数、时长、速率等）
- **通道控制**：可以在侧边栏单独控制每个通道的显示/隐藏
- **实时光标**：移动鼠标可以查看任意点的具体数值
- **数据导出**：可将当前显示的数据导出为JSON文件（按通道存储，包含采样率信息）
- **连接切换**：可在串口和WebSocket之间切换连接方式

## 项目结构

```
src/
├── components/          # Vue组件
│   ├── HeaderBar.vue    # 顶部导航栏（含连接方式选择）
│   ├── SidePanel.vue    # 侧边面板（含协议选择）
│   ├── OscilloscopeChart.vue # 示波器图表
│   ├── StatusBar.vue    # 状态栏
│   └── ChannelItem.vue  # 通道配置项
├── composables/         # Vue组合式API函数
│   ├── useSerial.ts     # 串口通信
│   ├── useWebSocket.ts  # WebSocket通信
│   ├── useProtocolParser.ts # 协议解析（支持JustFloat和FireWater）
│   ├── useDataBuffer.ts # 数据缓冲
│   ├── useChannelConfig.ts # 通道配置
│   └── useStorage.ts    # 数据存储
├── types/index.ts       # 类型定义
└── utils/helpers.ts     # 工具函数
```
