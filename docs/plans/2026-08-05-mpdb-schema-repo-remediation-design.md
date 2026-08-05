# MPDB 迁移、统一 Schema 与全 Repo 修复设计

日期：2026-08-05  
状态：已批准  
目标版本：`satellite-channel-sim/scenario-v3`

## 1. 背景与目标

当前仓库使用 `.mat`、`trajectory.csv`、`manifest.json`、文件名及帧数启发式规则，将外部射线追踪结果与统计信道模型连接。这套机制无法可靠表达数据来源、单位、实体身份、坐标系和物理可比性，也让 RT 导入、PDP、历史回放、校准和 API 形成多套不一致的数据定义。

本次改造以 Lauraycs MPDB 为新的 RT 数据源，删除旧文件名握手路径，并建立全仓库统一的场景、几何、CIR/PDP 和比较 Schema。同时修复审计中已经确认的物理、校准、API、测试、构建和结构问题。

用户允许为建立统一 Schema 进行破坏性接口调整。

## 2. 已验证的样本数据

样本目录包含一个 MPDB ZIP 和两个 Lauraycs 节点配置：

- MPDB：外层 ZIP → `R0B0S0D.mpdb` → PyTorch ZIP → `archive/data.pkl` 与 Storage。
- 卫星配置：`nodeGroup=baseStation`，节点 ID `47641`。
- 地面终端配置：`nodeGroup=terminal`，节点 ID `terminal-route-1785827004804`。

MPDB 样本包含：

- 179 个链路帧，`FRAME_ID=0..178`。
- 465,512 条射线路径。
- 实际载频 24.95 GHz。
- 每帧 TX/RX 坐标、天线索引和频率。
- 每条射线的时延、复数 `H`、AOA/ZOA、AOD/ZOD、路径长度、多普勒、信道类型和交互数据。

两个配置补齐：

- 1 秒采样间隔和 178 秒时间窗。
- 179 点带 UTC 时间戳的卫星轨迹。
- EPSG:32649 投影坐标和 WGS84 经纬度。
- 发射功率 23（Lauraycs 配置未显式声明单位，适配时记录单位推断）。
- 垂直极化、24.9017 dBi 标称增益、66° 波束宽度和旋转矩阵。
- 100 MHz 带宽。
- 下行链路方向。

MPDB 局部卫星坐标与配置 UTM 坐标相差固定原点：

```text
x = 361425.124 m
y = 3823045.806 m
z = 389.000 m
```

179 帧坐标对齐的 RMS 残差约为 1.6 cm，最大残差约为 3.3 cm，可以作为内容关联和坐标变换的强校验。

配置存在频率冲突：MPDB 为 24.95 GHz，卫星天线为 25 GHz，终端天线为 2.5 GHz，全局下行为 2.6 GHz。比较计算以 MPDB 实际频率为权威值，25 GHz 记录为近似一致，2.5/2.6 GHz 记录为非阻断冲突。若 MPDB 缺失实际频率且配置互相冲突，则拒绝仿真。

## 3. 选定方案

采用“共享安全 JavaScript 解析器 + Web Worker”方案：

- 浏览器本地解析，保持现有本地导入体验。
- Worker 避免约 65 MB `.pt` 解包和 46 万条射线处理阻塞 UI。
- 解析核心与浏览器 Worker 解耦，可在 Node 测试和后续服务端复用。
- 射线使用 TypedArray 列式存储，避免构造大量 JavaScript 对象。
- 不执行 `torch.load` 或通用 Pickle 反序列化。

备选的服务端上传解析和离线转换工具暂不作为主工作流。

## 4. UnifiedScenario v3

统一场景是 RT、统计模型、历史回放、校准、导出和 API 的唯一高层输入。

```js
{
  schemaVersion: "satellite-channel-sim/scenario-v3",
  scenarioId: "sha256:...",
  source: {
    format: "lauraycs-mpdb",
    mpdbVersion: 1,
    files: [
      { role: "mpdb", sha256: "..." },
      { role: "transmitter-config", sha256: "..." },
      { role: "receiver-config", sha256: "..." }
    ]
  },
  link: {
    direction: "downlink",
    transmitterId: "47641",
    receiverId: "terminal-route-1785827004804"
  },
  time: {
    startTimeUtc: "2026-08-03T17:36:50.000Z",
    sampleInterval_s: 1,
    frameCount: 179
  },
  carrier: {
    frequency_Hz: 24950000000,
    bandwidth_Hz: 100000000
  },
  coordinateReference: {
    geographicEpsg: 4326,
    projectedEpsg: 32649,
    localOrigin_m: { x: 361425.124, y: 3823045.806, z: 389.000 }
  },
  transmitter: {},
  receiver: {},
  groundSelection: null,
  geometry: {},
  rayTracing: {},
  diagnostics: { warnings: [], assumptions: [] }
}
```

### 4.1 单位

所有物理字段必须使用带单位后缀的名称，例如 `_Hz`、`_s`、`_m`、`_deg`、`_rad`、`_dBm`、`_dBW`、`_dBi`、`_dB`、`_K`、`_Pa`。无单位的 Lauraycs 原始值只能存在于适配器边界，进入领域模型前必须归一化并记录推断。

### 4.2 来源优先级

1. MPDB：实际载频、帧 ID、射线及直接观测信道数据。
2. Lauraycs 配置：时间轴、带宽、功率、天线、节点 ID 和地理轨迹。
3. 可验证推导：坐标原点、斜距、仰角、方位角和地面绝对高度。
4. 用户显式覆盖。
5. 禁止静默默认、文件名推断和“帧数一致即关联”。

### 4.3 用户选择静态地面点

系统不自动决定静态地面点。导入后必须由使用者明确选择一个 MPDB RX 帧：

```js
groundSelection: {
  selectedFrameId: 109,
  selectedBy: "user",
  selectedAtUtc: "...",
  matchTolerance_m: 0.1
}
```

UI 展示每帧的经纬度、高度、相对位移和按该点可获得的精确匹配帧数量。系统可以提示样本中第 109–178 帧处于同一位置，但不得自动选中。选择前禁用比较；改变选择后使已有统计结果失效并重算。

### 4.4 射线列式存储

```js
rayTracing: {
  frameOffsets: Uint32Array,
  linkId: Int32Array,
  channelType: Int16Array,
  delay_s: Float32Array,
  hReal: Float32Array,
  hImag: Float32Array,
  pathLength_m: Float32Array,
  doppler_Hz: Float32Array,
  aoa_deg: Float32Array,
  zoa_deg: Float32Array,
  aod_deg: Float32Array,
  zod_deg: Float32Array
}
```

可变长的内部交互点和交互类型使用 offsets + values 的 ragged array 表达。

## 5. 内容识别与关联

导入允许同时选择三个文件，但忽略文件名：

1. 根据 JSON 的 `type`、`version`、`nodeGroup` 识别配置角色。
2. 根据嵌套 ZIP、PyTorch archive 和 MPDB metadata 识别射线文件。
3. 使用 `meta.route_link.transmitter.id` 和 `receiver.id` 匹配节点配置。
4. 使用 `FRAME_ID` 对齐时间帧。
5. 使用卫星轨迹拟合局部坐标平移并验证残差。
6. 任一强校验失败均拒绝导入，不使用文件名或帧数兜底。

旧 `.mat + trajectory.csv + frame_*.mat` 直接导入、文件名握手及帧数兜底从 UI 和文档中删除。轨迹导出功能可以保留为独立工具，但不再参与 RT 结果关联。

## 6. 安全解析边界

解析器只实现样本所需的 Pickle Protocol 2 子集和以下白名单全局对象：

- `HyperRT.MiRT.MPDB.MPDBMS.Table`
- `HyperRT.MiRT.MPDB.MPDBMS.Column`
- PyTorch Tensor/Storage 重建描述
- `collections.OrderedDict`

解析器只构造普通描述对象和 TypedArray，不调用任意模块、构造函数或 reducer。未知 GLOBAL、未知操作码、越界 Storage、异常 shape/stride、重复或缺失关键列、ZIP 解压膨胀、超出配置上限的帧数/射线数均导致结构化拒绝。

## 7. 统一 ChannelFrame 与比较

RT 和统计结果都转换为：

```js
{
  frameId,
  timestampUtc,
  geometry: {
    satellitePosition,
    groundPosition,
    slantRange_m,
    elevation_deg,
    azimuth_deg,
    geometryMatch,
    groundPositionMismatch_m
  },
  cir: { taps, delayReference, delayResolution_s },
  pdp: { bins, normalization },
  metrics: {}
}
```

### 7.1 几何可比性

统计模型使用配置中的卫星轨迹，不重新通过 TLE/SGP4 传播。统计模型的全部帧使用用户选择的固定地面点。RT 帧按其原始 RX 与该固定点的距离分类：

- 小于等于容差：精确比较帧，进入默认汇总。
- 超过容差：近似比较帧，保留展示但不进入默认汇总。

### 7.2 PDP

统一使用 `P(τ)=Σ|h_l|²δ(τ-τ_l)`。每帧以最早到达路径作为 0 超额时延。默认时延分辨率为 `1 / bandwidth`，本样本为 10 ns。同一 bin 内的复数 tap 先相干相加，再取模平方；同时保留非相干功率和作为诊断。主图以最强 bin 归一化为 0 dB，默认指标门限为峰值以下 60 dB，但不删除原始射线。

### 7.3 绝对功率

MPDB 的 `H` 缺少公开的归一化和增益包含关系定义。主比较因此使用相对 PDP 和信道统计量。统计模型可以输出绝对接收功率、SNR 和 C/N0；RT 绝对接收功率默认标记为 unavailable。不得用 `23 dBm + 10log10(Σ|H|²)` 伪造 RT 接收功率。只有取得并验证 Lauraycs 标定定义后才能启用绝对比较。

### 7.4 指标

逐帧指标包括 RMS 时延扩展、平均超额时延、最大有效超额时延、有效 bin 数、峰值与剩余功率比、近似相干带宽、多普勒中心/扩展、角度扩展、PDP Jensen–Shannon 距离、加权时延距离和几何位置偏差。

全场景汇总包括精确匹配帧比例、各指标中位数/P5/P95、RT 落入统计置信区间的比例，以及按仰角和可靠信道类别分组的结果。`CHANNEL_TYPE` 数值在缺少正式映射时只保留原值，不擅自标注为 LOS、反射或散射。

### 7.5 可重复随机性

随机种子由 `scenarioId + frameId + realizationId` 确定。默认每帧执行 32 个统计实现，展示中位数和 P5–P95 区间。相同输入必须生成完全相同的比较报告。

## 8. 模块边界

- `src/domain/`：Schema、单位、验证错误和公共数据结构。
- `src/importers/mpdb/`：ZIP、白名单 Pickle、配置解析和实体关联。
- `src/workers/`：MPDB 后台解析与进度协议。
- `src/geometry/`：坐标、轨迹、斜距、仰角、速度和多普勒。
- `src/channel/`：统计 CIR、PDP 分箱和传播损耗。
- `src/comparison/`：帧对齐、指标、置信区间和报告。
- `src/calibration/`：地面校准、参数辨识和持久化。
- `src/features/`：导入、地面点选择、PDP、回放和校准 UI。
- `server/`：消费共享领域模块，不复制物理公式。

## 9. 全仓库修复工作流

### 9.1 工程基线与 Schema

- 建立 Vitest 和正式 `npm test`。
- ESLint 排除构建产物并清零源码错误。
- 引入 UnifiedScenario v3、ChannelFrame 和严格单位。
- 用 nullish/default validator 替换会覆盖合法零值的 `||`。
- CI 强制执行 test、lint、build。

### 9.2 MPDB 导入

- 安全 Pickle 子集、TypedArray Storage、Worker、内容识别、实体/帧/坐标校验、冲突诊断和用户地面帧选择。
- 删除旧文件名握手和帧数兜底。

### 9.3 RT/统计比较

- 统一 CIR/PDP、10 ns 分箱、确定性统计集合、几何分类和报告。

### 9.4 物理模型

- 修复显式 GEO 斜距被替换为 550 km。
- ECI/ECEF 速度转换加入地球自转速度项。
- 地平线以下返回 no contact。
- 统一并校验 TLE 新鲜度，取消前后端不一致的过期默认值。
- 允许 TEC=0，统一 EIRP、地面高度和 SNR 单位/边界。
- 修复城市散射仰角趋势。
- 门限以下返回 outage，不再返回最低 MODCOD。
- 启发式 NTN/DVB 适配器不再宣称标准合规。

### 9.5 地面校准

- 修复未定义 setter。
- 让散射功率偏移真正进入 CIR。
- 使用对应帧时间、轨迹和斜距。
- 分离 C/N、SNR 和 C/N0。
- 位置比较在导入覆盖状态之前完成。
- 加入可辨识性、置信区间和版本化持久化。
- 合成天气损耗不标记为真实测量。

### 9.6 API、回放和结构

- 修复空 MODCOD timeline 的 reduce 崩溃。
- API 严格校验数字、范围和单位，默认监听 `127.0.0.1`。
- WebSocket 限制计算频率和窗口。
- Historical Replay 使用有界 ChannelFrame 数据。
- 拆分 App、ChannelSimPanel 和 model 单体模块。
- 删除未使用的 mathjs，大型导入能力按需加载。
- 修复构建警告并同步 README/用户手册。

## 10. 验收标准

- 任意重命名三个输入文件仍能正确导入。
- 节点 ID 不匹配时拒绝，不使用文件名或帧数兜底。
- 样本解析为 179 帧、465,512 条射线和 24.95 GHz。
- 坐标对齐 RMS 残差约 1.6 cm。
- 用户未选择地面帧时不能开始比较。
- 相同场景和随机种子产生相同报告。
- 未知 Pickle 类型被安全拒绝。
- GEO 斜距、地球自转多普勒和地平线判断有数值回归测试。
- RT 绝对功率不可用时不得输出伪造值。
- `npm test`、`npm run lint`、`npm run build` 全部通过。
- 文档不再描述旧文件名握手机制。

## 11. 进度汇报

实施按工作批次汇报：完成项、测试证据、新风险和下一批内容。设计、计划、实现和最终验证分别形成清晰检查点。
