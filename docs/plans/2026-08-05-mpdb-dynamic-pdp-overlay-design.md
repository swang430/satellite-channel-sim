# MPDB 动态 PDP 叠加播放设计

## 1. 背景

现有系统已经能够在用户选择一个 MPDB RX frame 作为静态地面点后，使用 MPDB 卫星轨迹逐帧计算 RT PDP 与统计模型 PDP。`compareScenario` 默认对所有与静态点精确匹配的动态帧执行 32 次确定性统计 realization，并输出逐帧比较指标。

当前缺口在展示层：主 CIR 播放器只消费独立生成的理论时间线；RT/统计比较面板只显示单帧静态图。两套视图使用独立滑块，无法直观看到同一 MPDB frame 下 RT 和统计 PDP 随卫星移动的拟合变化。

## 2. 目标与非目标

### 2.1 目标

- 固定用户选择的地面位置，按 MPDB 卫星轨迹动态播放全部可比较帧。
- 在同一个 PDP 坐标系、同一个 frameId 和同一个播放时钟上展示统计与 RT 结果。
- 提供 `RT 叠加` 开关：关闭时只显示统计结果，开启时叠加 RT。
- 逐帧展示拟合指标，并明确相对功率的物理边界。
- 地面选择或场景 revision 改变时立即使旧报告失效。

### 2.2 非目标

- 不从 MPDB `H` 推导 RT 绝对接收功率、SNR 或 path loss。
- 不通过最近时间、数组下标或文件名连接 RT 与统计帧。
- 不把当前 UI 中自由运行的 TLE 时间线与 MPDB 时间线强行合并。
- 不自动替用户选择静态地面 frame。

## 3. 方案选择

采用统一比较播放时间轴：运行比较后，将 comparison report 提升到 `ChannelSimPanel`，由主 CIR 区域中的专用比较播放器消费。

未采用的方案：

- 只在原比较面板增加第二个播放器：会保留两个独立时间轴，容易误读。
- 将 RT 数据并入自由运行的 TLE timeline：TLE 时间窗可能与 MPDB 配置轨迹不一致，不能保证物理帧对齐。

## 4. 物理与帧对齐语义

每个比较播放帧必须来自同一个 comparison report frame：

- `frame.frameId` 是真实 MPDB frame ID；数组下标只用于播放器内部定位。
- 时间戳来自 MPDB 配置中的发射端轨迹点。
- 发射端位置来自 `scenario.transmitter.track[frameId]`。
- 接收端位置始终来自 `scenario.groundSelection.projectedPosition_m`，不会随 frameId 改变。
- RT PDP 来自该 frameId 对应的 `rayTracing.frameOffsets` 范围。
- 统计 PDP 来自相同 frameId、相同几何和相同载频/带宽的确定性统计集合。

默认只播放 `exact` 帧。`approximate` 帧保留计数和诊断，但不进入默认拟合播放。

RT 与统计 PDP 分别以各自最强 bin 归一化到 0 dB。叠加图只表达相对 PDP 形状、超额时延和动态变化；RT 绝对功率继续保持 `unavailable / UNDEFINED_H_NORMALIZATION`。

## 5. 组件与状态流

### 5.1 `ChannelComparisonPanel`

该组件继续负责：

- 运行、取消 32-realization 比较；
- 展示计算进度和报告摘要；
- 通过 `onReportChange(report)` 向父级提交成功报告；
- 在计算失败或场景失效时通过 `onReportChange(null)` 清除旧结果。

原有单帧静态 PDP 图和独立 frame slider 删除，避免重复播放器。

### 5.2 `ChannelSimPanel`

新增 comparison report 状态。父级只接受同时满足以下条件的报告：

- `report.scenarioId === scenario.scenarioId`；
- `report.comparisonRevision === scenario.comparisonRevision`。

重新导入 MPDB、确认其他地面 frame 或 comparison revision 变化时：

- 停止比较播放；
- 清除旧 report；
- 将播放索引归零。

输出区域在存在有效 comparison report 时渲染比较播放器；否则保持原理论 CIR 播放器。即使没有自由运行的理论 timeline，只要 comparison report 已生成，也必须显示比较播放器。

### 5.3 `PdpComparisonPlayer`

新增专用组件，输入为完整 comparison report，内部持有：

- 当前报告数组下标；
- 播放/暂停；
- FPS；
- `showRtOverlay`，报告首次就绪时默认为 `true`。

播放器循环遍历 `report.frames`，但 UI 始终显示真实 `frame.frameId` 和 UTC 时间。

### 5.4 纯 View Model

比较图数据由纯函数生成，负责：

- 将统计 median、P5、P95 转换为相对 dB；
- 将 RT PDP bins 转换为相对 dB；
- 根据 `showRtOverlay` 决定是否包含 RT dataset；
- 生成当前 frame 的几何、拟合指标和计数摘要；
- 对非有限值或空数据返回结构化错误，而不是交给图表静默处理。

## 6. UI 设计

比较模式下 CIR 卡片标题为 `CIR — Power Delay Profile / RT Fit`，并显示：

- `MPDB 对齐 · 固定地面点 FRAME X`；
- 播放/暂停按钮；
- 1–60 FPS 输入；
- 真实帧进度滑块；
- `RT 叠加` 开关。

开关语义：

- 关闭：统计中位 PDP 与 P5–P95 区间；
- 开启：在上述统计结果上增加红色 RT PDP。

图形约定：

- 青色实线：统计中位 PDP；
- 青色半透明区域或上下边界：P5–P95；
- 红色实线/点：RT 相对 PDP；
- 横轴：`Excess Delay (ns)`；
- 纵轴：`Relative Power (dB)`。

当前帧展示：

- UTC 时间、MPDB frameId；
- 仰角与斜距；
- Jensen–Shannon divergence；
- RMS delay spread difference；
- weighted delay distance；
- 当前帧序号、exact 总数和 approximate 排除数。

## 7. 错误与边界处理

- 未确认静态地面 frame：禁用比较，不显示 RT 叠加开关。
- 没有 exact 帧：返回 `COMPARISON_EXACT_FRAMES_EMPTY`，不生成空 report。
- RT frame 无射线：保留 `RT_FRAME_EMPTY`。
- frame offset 或 frameId 越界：保留结构化领域错误。
- 统计或图形数据包含非有限值：拒绝生成该报告，而不是绘制错误曲线。
- 报告与当前 scenarioId/revision 不匹配：视为 stale report 并丢弃。
- 关闭或重新开启 RT 叠加只改变视图，不重新计算 comparison report。

## 8. 性能

- 比较仍由用户显式启动，不在选择地面 frame 后自动运行。
- 继续使用逐帧 progress 与取消信号。
- 播放只切换预计算 report frame，不在动画 tick 中重新运行统计模型或解析射线。
- 图表关闭动画，避免高 FPS 下的补间累积。
- 不复制完整 MPDB TypedArray 到播放器状态；播放器只持有 comparison report。

## 9. 测试与验收

自动化测试必须覆盖：

1. 多个动态 frame 的 `receiverPosition_m` 始终等于用户选择的静态点，而 transmitter position 随 track 改变。
2. 非连续 MPDB frameId 按 report 顺序播放且显示真实 ID。
3. RT 开关关闭时无 RT dataset，开启时 RT 与统计来自同一 frame。
4. median/P5/P95 正确转换为相对 dB。
5. scenarioId 或 comparison revision 改变后旧报告失效。
6. 无 exact 帧返回 `COMPARISON_EXACT_FRAMES_EMPTY`。
7. 空 RT、越界 frame 和非有限图形数据返回结构化错误。
8. 真实 MPDB 样本生成 179 个动态比较帧，逐帧拟合指标为有限值。

最终验收命令：

```bash
npm run verify
node scripts/verify-mpdb-sample.mjs <MPDB.zip> <base.json> <terminal.json>
npm run full
```

`npm run full` 只做短时 UI/API 启动检查，确认后正常终止。
