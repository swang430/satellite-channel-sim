# 卫星信道仿真系统 — 使用手册 v2.2

**Satellite Channel Propagation Simulator**

图电一体化星地信道仿真与联动平台

---

## 📋 目录

1. [系统概述](#1-系统概述)
2. [安装与运行](#2-安装与运行)
3. [轨道配置 (SGP4)](#3-轨道配置-sgp4)
4. [链路预算与静态仿真](#4-链路预算与静态仿真)
5. [信道传播仿真面板](#5-信道传播仿真面板)
6. [地面测量校准系统](#6-地面测量校准系统)
7. [天气数据与实时同步](#7-天气数据与实时同步)
8. [数据导出](#8-数据导出)
9. [校准数据格式规范](#9-校准数据格式规范)
10. [物理常识验证模块](#10-物理常识验证模块)
11. [图电一体化与联动展示](#11-图电一体化与联动展示)
12. [RT CIR 导入与 A/B 对比](#12-rt-cir-导入与-ab-对比)
13. [Dense 导出与轨迹生成](#13-dense-导出与轨迹生成)
14. [附录：已知卫星 ID 速查](#附录已知卫星-id-速查)

---

## 1. 系统概述

本系统是一个基于 Web 的卫星通信信道仿真器，支持从 UHF 到 Ka 频段的端到端链路预算计算、动态轨道跟踪（SGP4）、信道脉冲响应（CIR）建模、以及地面测量数据校准。

### 核心功能

| 模块 | 功能 |
|------|------|
| 🛰️ 轨道配置 | SGP4 实时轨道计算、TLE 输入、地面站配置、过境预测 |
| 📊 链路预算 | 大气衰减（雨衰/气体/云雾）、Faraday 旋转、XPD |
| 📡 信道仿真 | 时间序列生成、CIR 多径建模、快衰落（闪烁）、多普勒频移 |
| 🎯 地面校准 | 多参数 Gauss-Newton 优化、已知卫星参考库 |
| 🌦️ 天气同步 | Open-Meteo API 实时/JSON 回放 |
| 🔬 RT 对比 | 导入射线追踪 CIR，与原生模型 A/B 同轨迹对比 |
| 📦 Dense 导出 | 可配间隔/时长/起始的密集轨迹导出 |

### 技术栈

| 库 | 版本 | 用途 |
|---|------|------|
| React | v19.2.0 | UI 框架 |
| Vite | v7.3.1 | 构建工具与开发服务器 |
| satellite.js | v6.0.2 | SGP4/SDP4 轨道传播 |
| Chart.js / react-chartjs-2 | — | 图表渲染（CIR、SNR、Skyplot、Ground Track） |
| jszip | — | ZIP 解析与生成 |
| mat-for-js | — | 浏览器端解析 MATLAB `.mat` 文件 |

---

## 2. 安装与运行

### 环境要求

- Node.js v18+
- npm 或 yarn

### 安装步骤

```bash
# 1. 克隆仓库
git clone https://github.com/swang430/satellite-channel-sim.git
cd satellite-channel-sim

# 2. 安装依赖
npm install

# 3. 启动开发服务器（通常在 http://localhost:5173/）
npm run dev

# 4. 构建生产版本
npm run build
```

---

## 3. 轨道配置 (SGP4)

启用 `Enable Real-time Orbit Tracking` 后，系统使用 SGP4 算法根据 TLE（Two-Line Element）数据实时计算卫星位置。

### TLE 输入

在 `TLE Line 1` 和 `TLE Line 2` 中输入目标卫星的 TLE 数据。可从以下来源获取：
- [CelesTrak](https://celestrak.org)
- [Space-Track](https://space-track.org)

### 卫星快速选择

系统内置多颗常用卫星预设（Quick Select 下拉框），包括 ISS、星网系列等。也可通过 NORAD ID 在线获取最新 TLE。

### TLE 新鲜度

系统自动检测 TLE epoch 年龄：
- ✅ **FRESH**（≤7 天）：精度良好
- ⚠️ **AGING**（7-30 天）：建议更新
- ❌ **STALE**（>30 天）：轨道预报可能严重偏差

### 地面站参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| GS Lat | 地面站纬度 (°N) | 22.54 (深圳) |
| GS Lon | 地面站经度 (°E) | 114.05 |
| GS Alt | 地面站海拔 (m) | 0 |

### 过境预测 (Pass Prediction)

位于卫星选择行右侧。设置搜索时长（默认 24h），点击 `🔍 Predict Passes` 即可列出所有可视过境：

| 列 | 说明 |
|----|------|
| AOS | 信号获取时刻（卫星升起） |
| TCA | 最近接近时刻（最高仰角） |
| LOS | 信号丢失时刻（卫星落下） |
| Max Elev | 最大仰角 |
| Quality | 🟢 Excellent（≥45°）、🟡 Good（≥20°）、🟠 Low（<20°） |

每行右侧有 `🌟 Export Golden` 按钮，可直接导出该 pass 的 Golden RT 轨迹。

---

## 4. 链路预算与静态仿真

主面板提供实时链路预算计算，根据仰角和降雨率动态更新。

### 输出指标

| 指标 | 说明 | 单位 |
|------|------|------|
| Free Space Loss | 自由空间路径损耗 | dB |
| Rain Attenuation | 雨衰（ITU-R P.838 模型） | dB |
| Gas Attenuation | 氧气 + 水蒸气吸收 | dB |
| C/N | 载噪比 | dB |
| XPD | 交叉极化鉴别度 | dB |
| Faraday Rotation | 电离层法拉第旋转角 | deg |

### 关键参数

| 参数 | 说明 | 典型范围 | 默认值 |
|------|------|---------|--------|
| Freq (GHz) | 工作频率 | 0.3 ~ 30 | 30 |
| EIRP (dBW) | 等效全向辐射功率 | 20 ~ 60 | 60 |
| G/T (dB/K) | 接收品质因数 | 10 ~ 45 | 42 |
| Rain Rate (mm/h) | 降雨率 | 0 ~ 100 | **0** |
| TEC | 总电子含量 (TECU) | 10 ~ 100 | 50 |

---

## 5. 信道传播仿真面板

基于 SGP4 轨道预测，在卫星过境期间生成完整的信道传播时间序列。

### 使用流程

1. **设置地面站坐标和链路参数**（频率、EIRP、增益等）
2. 点击 `🔍 Predict Passes` 搜索可用过境（位于卫星选择行右侧）
3. 从列表中选择一个 Pass 时段
4. 点击 `🚀 Generate Channel TimeSeries` 生成
5. 查看图表：Total Loss、C/N0、Elevation、CIR 等

### CIR（信道脉冲响应）

CIR 建模基于环境类型（rural / suburban / urban），包含直射径和多径散射分量：

| 环境 | Tap 数 | 说明 |
|------|--------|------|
| Rural | 2 | 直射 + 地面反射 |
| Suburban | 4 | 直射 + 地面反射 + 建筑散射 × 2 |
| Urban | 6 | 直射 + 多重反射/散射 |

### CIR 画布信息

CIR Power Delay Profile 画布右上角显示三行信息：

```
Line 1: Rx: -95.3 dBm | SNR: 12.5 dB | El: 45.1°
Line 2: FSPL: 186.7 dB | DS(σ_τ): 0.08 ns | Bc: 2578.9 MHz
Line 3: Doppler: +715.66 kHz (approaching ↑▲)
```

其中：
- **DS (σ_τ)**：RMS 时延扩展（Delay Spread）
- **Bc**：相干带宽（Coherence Bandwidth），Bc = 1/(5·σ_τ)，二者互逆关系
- **Doppler**：基于 SGP4 卫星径向速度的多普勒频移

### CIR 播放

- **FPS**：播放帧率（默认 **1**）
- **Play/Pause**：动态播放多径变化
- 拖动进度条可手动跳帧

### 快衰落（闪烁）

可通过 `Disable Fast Fading` 关闭闪烁效应，适用于清洁的慢衰落分析和数据回放。

---

## 6. 地面测量校准系统

使用地面实测数据校正仿真模型的系统偏差。校准使用 **Gauss-Newton** 多参数优化算法，同时调整 5 个独立参数。

### 校准原理

校准的目标是修正**设备偏差**和**环境偏差**，而非卫星本身的参数：

| 校准参数 | 含义 | 范围 |
|---------|------|------|
| 雨衰修正系数 | ITU-R 雨衰模型在本地的偏差修正 | 0.3 ~ 3.0 |
| 气体衰减偏移 | 本地大气密度/湿度偏差 | -2.0 ~ 2.0 dB |
| 散射功率偏移 | 多径散射环境修正 (CIR) | -10 ~ 5 dB |
| EIRP 偏移 | 接收链路增益/损耗偏差 | -5 ~ 5 dB |
| 系统噪温偏移 | 接收机噪声温度偏差 | -50 ~ 200 K |

### 使用步骤

1. 点击 `🛠️ 展开校准面板`
2. **导入测量数据**：上传 JSON 文件（格式见第 9 节）
3. **选择参考卫星**：从已知卫星库选择，或通过 JSON 的 metadata 自动填充
4. 点击 `🎯 运行多参数校准`
5. 查看校准结果（各参数值 + RMS 残差）
6. 使用 `✅ 已启用校准修正 / ❌ 未启用校准` Toggle 切换
7. 重新 Generate 对比校准前后效果

### 已知卫星参考库

| 卫星 | 类型 | 频段 | 适用场景 |
|------|------|------|---------|
| 中国空间站 天和 | LEO | S (2.2 GHz) | 动态仰角校准 |
| Intelsat 906 | GEO | C / Ku | 长时间雨衰校准 |
| SES Astra 2E | GEO | Ku / Ka | Ka 衰减校准 |
| MUOS-5 | GEO | UHF (0.36 GHz) | 电离层效应校准 |
| APStar-6D | GEO | Ku / Ka | 高吞吐量校准 |
| 北斗三号 MEO | MEO | L (1.268 GHz) | 电离层延迟校准 |

> ⚠️ **校准适用范围**：校准结果对**同一地点**有效。如果校准数据来源地点与当前地面站距离 >50 km，系统会显示黄色警告；>200 km 显示红色警告。

> ⛔ **自定义卫星必填字段**：频率 (freq)、发射功率 (eirp)、极化 (polarization)、带宽 (bandwidth)。缺少任何一个字段将**阻止校准**。

---

## 7. 天气数据与实时同步

位于页面下方的 `天气数据 & 实时同步` 面板提供实时和回放的降雨率数据。

| 模式 | 数据源 | 用途 |
|------|--------|------|
| Open-Meteo API | 在线气象 API | 实时驱动主面板雨衰可视化 |
| JSON Replay | 本地历史 JSON | 回放特定时段的天气条件 |

> 💡 天气同步面板仅影响主面板的实时图表展示。信道仿真面板使用自身的 Rain Rate 参数，两者独立互不影响。

---

## 8. 数据导出

信道仿真面板支持两种导出格式：

### CSV 导出

包含每个时间步的完整链路指标和 CIR 各 tap 的详细数据：

```
Time, Elevation, FSPL, RainAtten, GasAtten, TotalLoss, CN0, XPD, FaradayRot, Doppler_Hz,
CIR_Tap1_Label, CIR_Tap1_ExcessDelay, CIR_Tap1_Amplitude, CIR_Tap1_Phase, ...
```

### JSON 导出

包含完整的仿真参数和时间序列数据，可用于后续分析或回放。

---

## 9. 校准数据格式规范

### 格式一：已知卫星

```json
{
  "metadata": {
    "satellite": "CSS_TIANHE",
    "band": "S",
    "groundStation": {
      "lat": 22.54, "lon": 114.05, "alt": 0
    },
    "receiver": { "gRx": 42.0, "tRx": 150.0, "bandwidth": 400.0 },
    "environment": "suburban",
    "tec": 50,
    "description": "深圳站 CSS 天和过境观测"
  },
  "measurements": [
    {
      "timestamp": "2026-02-23T10:00:00Z",
      "elevation": 35.2,
      "rainRate": 3.0,
      "measuredCN0_dB": 11.5,
      "measuredRSSI_dBm": -87.2,
      "measuredXPD_dB": 27.5,
      "measuredAttenuation_dB": 3.8
    }
  ]
}
```

### 格式二：自定义卫星

```json
{
  "metadata": {
    "satellite": {
      "name": "MyCustomSat",
      "freq": 10.95,
      "eirp": 36.0,
      "polarization": "Linear-V",
      "bandwidth": 250.0,
      "modulation": "OFDM",
      "type": "LEO"
    },
    "groundStation": { "lat": 39.92, "lon": 116.39, "alt": 50 },
    "description": "北京站自定义卫星过境观测"
  },
  "measurements": [ ... ]
}
```

### 格式三：纯数组（向后兼容）

```json
[
  { "elevation": 35.2, "rainRate": 3.0, "measuredCN0_dB": 11.5 },
  ...
]
```

> ⚠️ 纯数组格式不携带卫星和地面站信息，需手动在面板中设置参数。

### 测量指标说明

| 字段 | 说明 | 必填 |
|------|------|------|
| `elevation` | 仰角 (°) | 强烈建议 |
| `rainRate` | 降雨率 (mm/h) | 建议 |
| `measuredCN0_dB` | 载噪比 (dB-Hz) | 至少一个 |
| `measuredRSSI_dBm` | 接收信号强度 (dBm) | 至少一个 |
| `measuredXPD_dB` | 交叉极化鉴别度 (dB) | 至少一个 |
| `measuredAttenuation_dB` | 总衰减 (dB) | 至少一个 |

---

## 10. 物理常识验证模块

系统内置了基于物理常识（Rule of Thumb）的验证模块，用于在生成仿真数据时，自动核对结果是否符合客观物理规律。

### 验证基准

- **自由空间路径损耗 (FSPL)**：接收功率与理论 Friis 方程的偏差应在合理范围内（0 ~ 8 dB 的大气/极化损耗）
- **多普勒与信噪比包络**：低轨卫星（LEO）过境必须呈现大动态范围（> 5dB）的抛物线
- **降雨衰减验证**：高频段（Ku/Ka）在强降雨下必须出现断崖式衰减；低频段（S/L）应表现出抗衰减特性
- **多径与环境衰落**：城市（Urban）环境相比开阔地（Rural）必须表现出显著的附加遮挡损耗

### Web 端 UI 诊断

在信道仿真面板中配置参数并点击 `🚀 Generate` 后，按 `F12` 打开浏览器控制台查看诊断报告。系统会自动进行理论预算与仿真结果的交叉比对。

---

## 11. 图电一体化与联动展示

系统提供宏观几何视图（轨道预测）与微观电磁视图（射线跟踪 CIR）的强绑定联动能力。

### Golden RT 轨迹提取

通过 `🌟 Export Golden RT Trajectory`，系统会在一次过境中智能提取 8-10 个关键几何突变点：
- 入场/出场 15° 仰角阈值
- 遮挡临界 45° 仰角
- 街道波导平行角（可配置 Street Azimuth）
- 最高仰角顶点

这些点用于导入 HyperRT 等昂贵的射线跟踪平台，用最少的算力跑出最显著的特征。

### 主从双向联动

1. **ZIP 导入**：将第三方软件跑出的 `.mat` CIR 结果文件与 `trajectory.csv` / `manifest.json` 放在同一个 ZIP 包中拖入
2. **空间锚点交互**：点击上方 Skyplot 或 Ground Track 上的黄色节点，下方 CIR 面板会瞬间跳帧至对应的物理时刻
3. **动态演进播放**：点击 CIR 面板的 `▶ Play`，可按设定的 FPS 动态播放多径瀑布，上方天空图的光标同步移动

---

## 12. RT CIR 导入与 A/B 对比

支持导入外部射线追踪（Ray Tracing）引擎生成的 CIR 数据，与系统原生 3GPP/ITU 模型进行 A/B 对比。

### 导入格式

将以下文件打包为 ZIP 后拖入 CIR 面板：

| 文件 | 格式 | 说明 |
|------|------|------|
| `frame_*.mat` | MATLAB .mat | 每帧包含 `RaysProperties` (N×19 矩阵) 和 `NumberRays` |
| `trajectory.csv` | CSV | 每帧对应的卫星位置，列：Timestamp, Latitude, Longitude, Altitude, Azimuth, Elevation, Slant Range |
| `manifest.json` | JSON | 可选：卫星 TLE、地面站坐标、任务 ID |

### MAT 文件中 RaysProperties 列定义

| 列索引 | 含义 |
|--------|------|
| col[0] | 射线类型 (1=LOS, 2=反射, 3=绕射, 4=散射) |
| col[2] | 传播时延 (s)——含卫星宏观传播时延 |
| col[4] | 电场实部 Re(E) |
| col[5] | 电场虚部 Im(E) |
| col[6] | 路径长度 (m)——地面场景内路径 |

### A/B 对比机制

点击 `🚀 Generate` 时，如果已导入 RT CIR，系统会：

1. **使用相同轨迹**：直接取导入帧的 el/az/range 几何参数（不做 SGP4 重算），确保两种 CIR 在完全相同的卫星位置下生成
2. **原生 CIR 画布**：显示 FSPL、Rx、SNR、DS、Bc、Doppler
3. **RT CIR 画布**：显示 RT PathLoss 和实际多径结构
4. 通过 `🔄 Native CIR / RT CIR` 按钮在两个视图间切换（按钮宽度固定，不影响进度条位置）

> ⚠️ **轨迹一致性**：RT 数据可能使用不同于当前 TLE 的卫星轨道。系统会自动从 `trajectory.csv` 提取精确几何参数，绕过 SGP4 传播，避免因卫星不同导致仰角/斜距错误。

### 典型工作流

```
1. 在系统中选择卫星 → Predict Passes → 🌟 Export Golden 导出轨迹 ZIP
2. 将 trajectory.csv 导入外部 RT 引擎（如 HyperRT）
3. RT 引擎生成 frame_*.mat → 与 trajectory.csv 一起打包为 ZIP
4. 将 ZIP 拖入 CIR 面板 → 查看 RT 多径结构
5. 点击 Generate → 查看原生 3GPP/ITU 模型结果
6. 切换 Native/RT 视图对比两者差异
```

---

## 13. Dense 导出与轨迹生成

`⬇️ Export Simulation Project (Dense)` 用于生成密集采样的卫星轨迹文件，供外部仿真平台消费。

### 可配置参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 采样间隔 (ms) | 100 | 轨迹点之间的时间间隔，可设 1ms ~ 10000ms |
| 时长 (min) | 0 (自动) | 0 = 自动选择整个过顶窗口；>0 = 手动指定分钟 |
| 起始时间 | 自动 | 留空 = 搜索 72h 内最高仰角 pass 的 AOS-2min |

### 起始时间格式

手动输入时使用 **ISO 8601** 格式：

| 格式 | 示例 |
|------|------|
| UTC | `2026-03-15T12:00:00Z` |
| 带时区 | `2026-03-15T20:00:00+08:00` |
| 留空 | 自动搜索未来 72h 最高仰角 pass |

> 💡 **提示**：可先运行 Pass Prediction，从结果表中找到合适的过境，将 AOS 时间复制到起始时间字段。

### 导出文件内容

导出的 ZIP 包含：
- `trajectory.csv`：密集采样的卫星轨迹（Timestamp, Lat, Lon, Alt, Az, El, SlantRange）
- `manifest.json`：任务 ID、卫星 TLE、地面站坐标、链路参数

---

## 附录：已知卫星 ID 速查

在校准 JSON 的 `metadata.satellite` 中使用以下 ID 引用内置卫星：

| JSON ID | 名称 | 可用频段 |
|---------|------|---------|
| `CSS_TIANHE` | 中国空间站 天和 | S |
| `INTELSAT_906` | Intelsat 906 | C, Ku |
| `SES_ASTRA_2E` | SES Astra 2E | Ku, Ka |
| `MUOS_5` | MUOS-5 | UHF |
| `APSTAR_6D` | APStar-6D | Ku, Ka |
| `BEIDOU_3_MEO` | 北斗三号 MEO | L |

---

*Satellite Channel Propagation Simulator v2.2 | 2026-03*
