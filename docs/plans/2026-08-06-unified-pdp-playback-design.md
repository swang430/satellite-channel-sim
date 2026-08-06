# 统一统计 / RT PDP 播放设计

## 目标

恢复统计信道的主体地位：无 MPDB 时按用户选定的过顶窗口播放统计 PDP；导入 MPDB 后切换到 MPDB 原生时间窗口，将 RT 射线聚合成 PDP 并作为可开关图层叠加。

## 时间窗口优先

- TLE 模式自动搜索多个过顶窗口，但不自动代替用户选择。
- 用户选中窗口后自动生成完整统计时间序列。
- MPDB 模式以数据中的起止 UTC、采样间隔、frameId 和逐帧 TX/RX 几何为权威窗口。
- 默认展示完整窗口；时间轴缩放只改变视口，不改变帧身份和统计/RT 对齐。

## 统一播放数据

```text
PlaybackReport
├─ timeWindow { source, startTimeUtc, endTimeUtc, sampleInterval_s, frameCount }
└─ frames[]
   ├─ frameId / timestampUtc / receiver / geometry
   ├─ statistical { realizationCount, PDP median, P5, P95, metricSummary }
   ├─ link { rxPower_dBm, snr_dB }              # TLE 模式
   ├─ rt { pdp, ... }                           # 仅 MPDB
   └─ metrics { JS, RMS difference, distance }  # 仅 MPDB
```

TLE 和 MPDB 均对每帧运行 32 次确定性 realization。播放器始终显示统计 median 与 P5/P95；只有当前 MPDB 报告对齐成功时才显示 RT 开关和拟合指标。

## 交互与刷新

- 修改 TLE 或地面站会使旧过顶选择失效，重新搜索后等待用户选择。
- 修改环境、TEC、带宽或校准只重算当前窗口，不改变窗口。
- 刷新期间保留上一版统计 PDP；当前统计结果完成前禁用 RT 与拟合指标。
- 切换统计参数时按时间戳保留当前播放位置；切换窗口时从新窗口首帧开始。
- 旧 CIR taps Canvas 退出主播放区，不再代替 PDP bins 展示。

## 错误边界

- 没有可见过顶时不伪造“从当前时间”窗口。
- MPDB 缺失可靠时间戳、TX/RX 轨迹或帧对齐时拒绝 RT 图层，不破坏统计播放器。
- RT 某帧无有效射线时，该帧仅展示统计 PDP 并标记 RT 不可用。
- 帧对齐使用 frameId 与 timestamp 双重校验，不使用文件名或最近邻猜测。

## 验收

- 无 MPDB 时，任一已选过顶窗口均可播放动态统计 median/P5/P95 PDP。
- 切换过顶窗口会同步改变时间、轨迹、几何和 PDP。
- 导入 MPDB 后的播放范围与 MPDB 完全一致，同帧统计、RT、轨迹、几何和指标一致。
- RT 开关、时间轴缩放和参数刷新不会使统计 PDP 消失。
- 真实 MPDB 179 帧样例通过端到端回归。
