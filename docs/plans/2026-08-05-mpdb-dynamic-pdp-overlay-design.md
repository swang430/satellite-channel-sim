# MPDB 动态 PDP 叠加播放设计

## 1. 背景

现有系统可以解析 MPDB 的逐帧卫星位置、接收端位置和 RT 射线，也可以按指定几何生成统计 PDP。但是当前比较流程把用户选择的一个 RX frame 固定为地面点，只比较与该点距离小于容差的 RT 帧；主 CIR 播放器与 RT/统计比较面板也使用不同时间轴。

真实样本揭示了这种假设的问题：卫星轨迹包含 179 帧，接收端在 frame 0–107 移动，在 frame 108–178 基本静止。如果强制选定一个固定点，大部分已有 RT 帧会因为接收端位置不同而失去可比性。

产品最终选择完全跟随 MPDB 原始接收端轨迹。每个 frame 都使用该 frame 自己的发射端位置、接收端位置和 RT 射线；统计模型在同一几何上重算。若需要固定地面点，用户应从 Lauraycs 生成固定终端 MPDB 后再导入。

## 2. 目标与非目标

### 2.1 目标

- 完整播放 MPDB 的全部 receiver/satellite 动态帧。
- 每帧在完全相同的收发几何上比较 RT PDP 与统计 PDP。
- 在同一 PDP 坐标系、同一个 frameId 和同一个播放时钟上展示两种结果。
- 提供 `RT 叠加` 开关：关闭时只显示统计结果，开启时叠加 RT。
- 显示接收端当前坐标、帧间位移和移动/静止状态。
- 明确相对 PDP 的物理边界，不伪造 RT 绝对功率。

### 2.2 非目标

- 不提供“把移动终端 MPDB 转换成固定终端 RT”的模式。
- 不要求用户选择一个 ground frame 才能开始比较。
- 不按位置容差排除 MPDB 原生帧，也不再使用 exact/approximate 作为默认比较分类。
- 不从 MPDB `H` 推导 RT 接收功率、SNR 或 path loss。
- 不通过最近时间、数组下标或文件名连接 RT 与统计帧。
- 不把自由运行的 TLE timeline 与 MPDB timeline 强行合并。

## 3. 帧级几何语义

每个比较帧由相同 `frameId` 的四类数据组成：

```text
frameId
├─ transmitter.track[frameId]         MPDB 配置卫星位置与时间
├─ receiver.track[frameId]            MPDB RT 接收端位置
├─ rayTracing.frameOffsets[frameId]    MPDB RT 射线范围
└─ statistical ensemble               使用上述同帧收发几何重算
```

场景装配把旧的 `groundCandidates` 正式收敛为 `receiver.track`，并移除 `groundSelection`。`scenarioFrameGeometry` 逐帧读取 `receiver.track[frameId].projectedPosition_m`。由于 Scenario v3 尚未合并发布，这次破坏性调整直接成为最终 v3 契约，不额外保留过渡字段。因此：

- 接收端移动时，统计模型跟随移动；
- 接收端位置不变时，统计模型自然保持固定；
- RT 与统计模型始终使用同一 frame 的接收端位置；
- 全部合法 MPDB frame 都进入比较，不需要位置近似。

comparison report 明确记录：

```js
receiverGeometry: {
  mode: 'mpdb-track',
  source: 'rayTracing.rxPosition',
  frameCount: 179
}
```

统计模型使用当前 UI 的 environment、TEC 和已启用校准中的 scatter power offset。报告保存这些参数及稳定 request key；任一参数变化都会使旧 RT 与拟合结果失效并触发自动重算，防止把不同理论条件下的结果继续叠加到 RT。重算期间保留上一版统计 PDP 作为可见基础层，并明确标记刷新状态。

## 4. 接收端运动状态

每帧记录与前一帧的接收端位移：

- 首帧：`initial`；
- 位移小于等于 0.1 m：`stationary`；
- 位移大于 0.1 m：`moving`。

该状态只用于展示和诊断，不改变帧是否参与比较。0.1 m 是 UI 运动分类阈值，不是 RT/统计匹配容差。

播放器显示：

- 当前接收端经纬度和高度；
- 帧间位移，m；
- `移动`、`静止` 或 `初始帧`；
- 卫星仰角和斜距。

## 5. PDP 与拟合语义

RT 与统计结果都使用统一 PDP 规则：

- 每帧以最早路径为 excess-delay 零点；
- 分箱宽度为 `1 / bandwidth`；
- 同一 bin 内先对复振幅相干聚合，再计算功率。

MPDB `H` 没有可追溯的绝对功率归一化，因此 RT 与统计 PDP 分别以各自最强 bin 归一化到 0 dB。叠加图只表达相对 PDP 形状、时延结构及其动态变化；RT 绝对功率继续保持：

```text
unavailable / UNDEFINED_H_NORMALIZATION
```

逐帧拟合指标包括：

- Jensen–Shannon divergence；
- RMS delay spread difference；
- weighted delay distance。

## 6. 组件与状态流

### 6.1 `MpdbImportPanel`

删除 ground frame slider、确认按钮和稳定帧建议。导入成功后展示 receiver track 摘要：

- 总 frame 数；
- 起点和终点坐标；
- 累计移动距离；
- moving/stationary frame 数；
- 数据来源为 MPDB RX position。

导入成功即满足比较的接收端几何条件。

### 6.2 `ChannelComparisonPanel`

继续负责：

- 运行、取消 32-realization 比较；
- 在 MPDB 导入或统计 request key 变化后自动运行比较；
- 展示计算进度和报告摘要；
- 通过 `onReportChange(report)` 向父级提交成功报告；
- 在计算失败或场景替换时清除旧结果。

原有单帧静态 PDP 图和独立 slider 删除，避免两个播放器。

### 6.3 `ChannelSimPanel`

持有 comparison report。父级只将 scenarioId 和统计 request key 都匹配当前输入的报告视为当前有效结果。重新导入不同场景会清除旧 report；修改 environment、TEC 或校准散射偏移会停止播放并归零索引，但在自动重算完成前保留同场景旧 report 的统计 PDP 作为预览，不展示其 RT 与拟合指标。

存在当前有效 report 时，主 CIR 区域进入 MPDB 对齐比较模式；参数变化触发新 report 计算时，继续用上一版 report 显示统计 PDP 基础层，但关闭 RT 与拟合指标。没有任何 MPDB report 时保持原自由运行统计 CIR 播放器。

### 6.4 `PdpComparisonPlayer`

专用播放器内部持有：

- 当前 report 数组位置；
- 播放/暂停；
- FPS；
- `showRtOverlay`，首次加载时默认 `true`。

播放器按 report frame 顺序循环，但 UI 始终显示真实 MPDB `frameId` 和 UTC 时间。

### 6.5 纯 View Model

纯函数负责：

- median、P5、P95 和 RT PDP 的相对 dB 序列；
- 根据 `showRtOverlay` 生成 dataset；
- 真实 frameId、接收端运动状态、几何和拟合指标摘要；
- 非有限或空图形数据的结构化拒绝。

## 7. UI 设计

比较模式下主卡片标题为 `CIR — Power Delay Profile / RT Fit`，显示：

- `MPDB 对齐 · RX 跟随原始轨迹`；
- 播放/暂停；
- 1–60 FPS；
- 完整 MPDB frame slider；
- `RT 叠加` 开关。

开关语义：

- 关闭：统计中位 PDP 与 P5–P95；
- 开启：在统计结果上增加红色 RT PDP。

颜色：

- 青色实线：统计中位 PDP；
- 青色半透明虚线：P5/P95；
- 红色实线/点：RT 相对 PDP。

坐标轴：

- 横轴：`Excess Delay (ns)`；
- 纵轴：`Relative Power (dB)`。

## 8. 领域边界与错误处理

- MPDB receiver position 数量必须等于 frameCount；否则拒绝装配或比较。
- 缺失某 frame 的 RX 位置：`RECEIVER_TRACK_FRAME_MISSING`。
- RT frame 无射线：保留 `RT_FRAME_EMPTY`。
- frame offset 或 frameId 越界：保留结构化领域错误。
- 统计或图形数据包含非有限值：拒绝报告，不交给图表静默处理。
- report 与当前 scenarioId 不匹配：视为 stale report。
- RT 叠加开关只改变视图，不重新计算。
- 固定终端数据无需特殊模式；若 MPDB 每帧 RX position 相同，播放器自然显示全程静止。

## 9. 性能

- MPDB 导入和统计 request key 变化会自动启动比较；用户仍可手动重跑或取消。
- 保留逐帧进度和取消信号。
- 播放只切换预计算 report，不在 tick 中重跑模型或解析射线。
- 图表关闭动画。
- 不复制完整 MPDB TypedArray 到播放器状态。

## 10. 测试与验收

自动化测试覆盖：

1. 每个动态 frame 的 transmitter 与 receiver 都来自同 frame MPDB track。
2. receiver 移动、静止和初始状态按帧间位移正确分类。
3. 非连续 frameId 仍按 report 顺序播放并显示真实 ID。
4. RT 开关关闭时无 RT dataset，开启时 RT 与统计来自同 frame。
5. median/P5/P95 正确转换为相对 dB。
6. 新场景导入后旧 report 失效。
7. 缺失 RX frame、空 RT、越界 frame 和非有限图形数据返回结构化错误。
8. 真实 MPDB 样本生成 179 个 comparison frame；前段接收端移动、后段静止；所有逐帧拟合指标有限。

最终验收：

```bash
npm run verify
node scripts/verify-mpdb-sample.mjs <MPDB.zip> <base.json> <terminal.json>
npm run full
```

`npm run full` 仅做短时 UI/API 启动检查，确认后正常终止。
