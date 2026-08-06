# 统一 CIR 播放分析设计

**日期：** 2026-08-06

**状态：** 已批准

**目标：** 让统计链路分析在所有播放模式中始终存在，并在导入 MPDB 后补充来源清晰、物理定义明确的 RT 路损与 Doppler 合成信息。

## 背景与根因

当前 `ChannelSimPanel` 只在没有 MPDB comparison report 时显示 Loss Breakdown、Rx/SNR 趋势和 Frame Details。面板直接读取 TLE `timeline[cirIdx]`，而 MPDB 播放器读取 comparison report；导入 MPDB 后两者时间轴不同，因此代码用 `!displayedComparisonReport` 隐藏旧面板以避免错帧。

修复不能只是取消隐藏。需要建立统一的逐帧分析结构，让统计窗口和 MPDB 窗口都从播放器当前帧生成同一种 view model。

## 设计原则

1. 统计模型是基线，任何模式下都不被 RT 替换或隐藏。
2. 所有详情、趋势和告警必须跟随播放器当前 frame ID 和 UTC。
3. 每个指标携带 `STAT`、`RT`、`DERIVED` 或 `UNAVAILABLE` 来源语义。
4. MPDB 没有声明复数 `H` 的绝对功率归一化时，不生成伪造的 RT 绝对路损。
5. PDP 只表达时延域；Doppler 和路损使用独立趋势图，避免混合坐标单位。
6. 合成公式固定、确定性，并在报告中记录方法名称。

## 统一逐帧分析结构

新增纯数据适配层 `PlaybackFrameAnalytics`。建议结构如下：

```js
{
  frame: {
    scenarioId,
    windowSource,
    frameId,
    timestampUtc
  },
  geometry: {
    receiver,
    transmitter,
    receiverMotion,
    receiverDisplacement_m,
    elevation_deg,
    azimuth_deg,
    slantRange_m
  },
  statistical: {
    loss,
    link,
    delay,
    doppler
  },
  rt: {
    availability,
    relativeGain,
    delay,
    doppler,
    angles,
    pathCount,
    occupiedDelayBinCount,
    dominantPathShare
  },
  comparison: {
    jsDivergence_bits,
    weightedDelayDistance_s,
    rmsDelaySpreadDifference_s,
    dopplerCentroidDifference_Hz
  },
  alerts: []
}
```

该结构由纯函数生成，UI 不再直接读取 TLE timeline 或 MPDB typed arrays。

## 统计链路预算

每个播放帧都计算并保留下列统计损耗：

\[
L_\text{stat}=L_\text{FSPL}+L_\text{rain}+L_\text{gas}+L_\text{cloud}
+L_\text{shadow}+L_\text{Faraday}+L_\text{pointing}
+L_\text{scan}+L_\text{multipath}+L_\text{scintillation}
\]

在 selected-pass 模式中复用当前 TLE timeline 的几何和链路预算结果。在 MPDB 模式中使用 MPDB 当前帧的频率、仰角、斜距和时间，结合当前统计场景、天气、TEC 与校准参数重新计算，不使用旧 TLE 帧。

`totalPropagationLoss_dB` 只表示传播损耗。接收功率与 SNR 另外记录其 EIRP、接收增益、噪声温度和带宽来源，避免把天线增益混入“路损”。

Loss Breakdown 始终显示：FSPL、雨、气体、云、阴影、Faraday、指向、扫描、多径和闪烁。正损耗和负损耗/增益使用不同视觉语义。

## RT 总功率与相对增益

RT 每帧先按接收机时延分辨率聚合。同一时延 bin 内相干合成，不同可分辨 bin 之间按功率相加：

\[
P_\text{RT,total}(t)=\sum_k\left|\sum_{l\in k}h_l(t)\right|^2
\]

该值可生成：

- `relativeToWindowPeak_dB`
- `relativeToFirstFrame_dB`
- 当前帧总合成功率的无量纲值

只有在 MPDB 明确提供绝对 `H` 归一化规则后，才允许生成 RT 绝对路损。当前显示 `RT_ABSOLUTE_PATH_LOSS_UNAVAILABLE`，并说明相对增益依赖“跨帧 H 标度一致”的输入假设。

## Doppler 合成

### 统计几何 Doppler

selected-pass 模式继续使用 SGP4 相对径向速度结果。MPDB 模式根据连续帧斜距变化计算径向速度：

\[
v_r(t)=\frac{dR(t)}{dt},\qquad
f_{D,\text{geom}}=-\frac{f_c}{c}v_r(t)
\]

中间帧使用中心差分，首尾帧使用单边差分。统一约定正值表示接近、负值表示远离。

### RT Doppler 质心

每条射线以非相干路径功率 `w_l = |h_l|²` 加权：

\[
\bar f_D=\frac{\sum_l w_l f_{D,l}}{\sum_l w_l}
\]

质心作为终端总体频移的主指标。

### RT RMS Doppler 扩展

\[
\sigma_D=\sqrt{\frac{\sum_l w_l(f_{D,l}-\bar f_D)^2}{\sum_l w_l}}
\]

同时记录：

- 最强径 Doppler
- Doppler 最小值和最大值
- 最强径功率占比
- Doppler 相干时间估计及明确的方法标识

合成复信号的瞬时相位导数不作为当前主指标，因为它在深衰落点不稳定，并依赖接收机 PLL、采样率和跨帧路径连续性。

## PDP bin tooltip

每个 RT PDP 时延 bin 除相对功率外，还提供：

- 聚合射线数
- bin 内功率加权 Doppler
- bin 内 RMS Doppler 扩展
- 功率加权 AoA/AoD

统计 PDP tooltip 保留中位数与 P5–P95。

## 页面布局

采用分层同步布局：

1. 时间窗口、播放控制、缩放和当前帧。
2. 当前帧核心指标：统计总路损、RT 相对增益、统计 Doppler、RT 质心、RT Doppler spread、RMS 时延扩展和路径数。
3. 统计/RT 离散 PDP 主图。
4. 两条同步趋势图：
   - 统计总路损与 RT 相对增益。
   - 统计几何 Doppler、RT Doppler 质心和 `质心 ± RMS spread`。
5. 始终可见的 Loss Breakdown 与 Frame Details。
6. 可折叠 RT Advanced：AoA/AoD、角度扩展、主径和原始路径类型。

时间缩放控制趋势图视口和播放范围。当前播放帧在所有图中使用同一游标。

## Loss Breakdown

不再把约 180 dB 的 FSPL 与数 dB 附加损耗放在同一个普通柱状图中。面板改为：

- 顶部汇总：统计总路损、FSPL、附加损耗合计。
- 水平分项：雨、气体、云、阴影、Faraday、指向、扫描、多径和闪烁。
- RT 区域：相对窗口峰值、相对首帧和绝对路损可用性。

## Frame Details

Frame Details 分为四组：

- Geometry：UTC、Frame ID、收发位置、仰角、方位角、斜距、终端移动状态。
- Link：统计总路损、Rx、噪底、SNR、链路余量和字段来源。
- Delay：路径数、有效 bin、首达时延、平均超额时延、RMS 时延扩展和相干带宽。
- Doppler：统计几何 Doppler、RT 质心、RMS spread、最强径 Doppler和相干时间。

未导入 MPDB 时 RT 字段显示“未导入”，统计字段保持完整；导入后只补充 RT 字段。

## 告警与不可用状态

首批实现只加入有明确物理或数据依据的状态：

- RT 绝对路损不可用。
- RT 相对增益的跨帧标度一致性假设。
- Doppler 正负过零事件。
- 输入功率为零、非有限值或没有有效射线时，相关合成指标不可用。

“高 Doppler spread”“高 PDP divergence”等阈值在没有用户配置前只显示数值，不擅自分配严重等级。

## 数据流与性能

MPDB comparison 计算时一次性生成全窗口 analytics，不在 React render 中扫描 typed arrays。趋势图直接消费预计算序列；当前帧切换只做数组索引。

场景参数变化时只重算统计链路预算和依赖它的指标；原始 RT 合成缓存按 `scenarioId + frameId` 保留。任何刷新都按 UTC 尝试保持当前播放位置。

## 测试与验收

自动测试覆盖：

1. selected-pass 和 MPDB 都生成统一 analytics。
2. 导入 MPDB 后统计 Loss Breakdown 与 Frame Details 不消失。
3. MPDB frame ID、UTC 与所有面板同步。
4. 手算可验证的 Doppler 质心、RMS spread、最强径与几何 Doppler。
5. RT 总功率按 bin 内相干、bin 间功率求和。
6. 绝对 H 归一化缺失时不生成 RT 绝对路损。
7. RT 缺失或不可用时统计趋势、详情和 PDP 仍完整。
8. 参数刷新保持当前 UTC，避免跳回第一帧。

浏览器验收同时覆盖 selected-pass 和真实 179 帧 MPDB，检查播放、缩放、RT 开关、当前帧游标、Loss Breakdown、Frame Details 与 Doppler 趋势同步。
