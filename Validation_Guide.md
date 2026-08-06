# 验证指南

本指南说明如何验证轨道、统计信道、Lauraycs MPDB 导入、RT 对比、校准和 API 边界。验证原则是：单位明确、来源可追溯、不可比较的数据明确 unavailable，不使用视觉上“像正确”的常数修补。

## 1. 自动化入口

```bash
npm run test
npm run lint
npm run build
npm run verify
```

`npm run verify` 必须同时满足：所有 Vitest 与物理回归测试通过、ESLint 零错误、Vite production build 零警告。

物理回归入口：

```bash
npm run test:physics
```

该命令运行确定性的数学边界、统计 CIR/时间序列和链路物理常识检查。校准由 `tests/calibration/` 下的 Vitest 测试覆盖；仅打印坐标、没有断言的 SGP4 调试脚本已删除。

## 2. 轨道与链路几何

重点检查：

- TLE epoch 新鲜度有结构化诊断，不声明 stale TLE 的实时精度；
- 经纬高单位分别为 degree、degree、meter；
- satellite.js 高度只在边界处转换为 km；
- ECI 到 ECEF 的速度转换包含 `-ω×r`；
- 多普勒统一由相对径向速度和载频计算；
- `elevation_deg <= 0` 的状态不作为有效接触；
- LEO/GEO 使用各自真实斜距。

FSPL 基准：

```text
FSPL(dB) = 20log10(d_km) + 20log10(f_GHz) + 92.45
```

## 3. 统计 CIR/PDP

统计 CIR 必须保留：载频、带宽、斜距、环境、TEC、散射偏移和 seed 来源。

PDP 统一规则：

1. 以最早到达路径为 excess-delay 零点；
2. 默认 10 ns 分箱；
3. 同一 bin 内复振幅相干相加；
4. 功率由相干结果计算；
5. 平均时延和 RMS 时延扩展使用同一归一化 PDP。

GEO smoke test 不得被 LEO 默认高度覆盖；`tec_TECU=0`、`rainRate=0`、`scatterPowerOffset_dB=0` 必须原样保留。

无 MPDB 时，面板必须自动列出可用过顶窗口，但禁止默认选中某个窗口或悄悄回退到“从当前时间”。用户选中后，统计播放报告必须保存窗口起止 UTC、采样间隔和帧数，且每帧显示 32-realization median/P5/P95。修改统计参数时窗口不得变化。

## 4. MPDB 导入

导入必须使用三个显式文件，但不得通过文件名建立关系。验证内容包括：

- JSON 内容分类为 base station / terminal；
- simulation window、sample interval 和 simulation type 一致；
- satellite ID 与 transmitter entity 对齐；
- Pickle GLOBAL/REDUCE 白名单和资源上限生效；
- storage dtype、byteorder、shape、stride 和长度一致；
- `LINK_ID` 单调并生成正确 `frameOffsets`；
- 必需列存在，复数 `H` 正确拆分；
- 坐标拟合 RMS 与最大残差均有报告；
- 载频冲突保留 provenance 和结构化诊断。

真实样本命令：

```bash
node scripts/verify-mpdb-sample.mjs <MPDB.zip> <base.json> <terminal.json>
```

验收阈值：

| 指标 | 预期 |
|---|---:|
| frame count | 179 |
| ray count | 465,512 |
| carrier | 24,950,000,000 Hz |
| coordinate RMS | < 0.05 m |
| comparison frames | 179 |
| realizations per frame | 32 |
| receiver geometry mode | `mpdb-track` |

动态比较报告还必须满足：frameId 从 0 到 178 连续，Jensen–Shannon divergence、加权时延距离和 RMS 时延扩展差逐帧为有限值；接收机轨迹摘要中首帧单列为 initial，移动帧与静止帧只统计后续 178 个帧间转移。还必须验证任意重命名后仍能导入，以及错配配置会被拒绝。

## 5. MPDB 原生接收机轨迹比较

MPDB 接收机轨迹是逐帧比较的几何事实源。对 frame N，必须同时使用 TX track[N]、RX track[N]、RT frameOffsets[N] 和相同 TX/RX 几何重新生成的统计信道；不得在 UI 中冻结某一帧的 RX 坐标来代替整段轨迹。移动段按移动位置播放，静止段按静止位置播放。固定点比较必须使用 Lauraycs 生成的固定终端 MPDB。

三项输入不得通过文件名关联。关联与拒绝规则必须覆盖：

- 按内容识别 base station / terminal 配置角色；
- 校验实体身份、仿真时间窗与采样间隔；
- 通过 `scenarioId`、连续 `frameId` 和 `frameOffsets` 对齐；
- 配置身份或时间窗错配必须拒绝。

统计 ensemble 默认 32 次 realization，seed 由 scenario ID、frame ID 和 realization ID 决定。相同输入必须得到相同结果。

统一 PDP 播放器中统计 median 使用青色，P5/P95 显示为边界，且在没有 MPDB 时也必须可播放。MPDB 模式的 RT 叠加默认开启，RT PDP 使用红色。播放器必须展示窗口起止时间、采样间隔、真实 frameId、UTC、RX 坐标、运动状态、帧间位移、仰角和斜距；MPDB 模式另显示三项拟合指标。环境、TEC 或已启用校准中的散射功率偏移变化后，当前 RT 与拟合结果必须立即失效并自动重算；重算期间统计 PDP 基础层仍须可见。

RT 绝对功率必须保持：

```text
unavailable / UNDEFINED_H_NORMALIZATION
```

RT 与统计 PDP 必须分别做峰值归一化，只允许比较相对 PDP 的形状和时延结构；不得把图形重叠解释为绝对功率拟合，也不得从 `H` 伪造 SNR、接收功率或路径损耗。

## 6. 校准

校准输入必须区分：

- `cn0_dBHz`：C/N0，dB-Hz；
- `cn_dB`：带宽积分后的 C/N，dB；
- `snr_dB`：SNR，dB；
- `rssi_dBm`：接收功率；
- `attenuation_dB`：大气衰减。

每个需要绝对链路预算的点必须提供 `slantRange_km`，不得缺省到 GEO 距离。参考卫星只能覆盖明确提供的字段，并记录带宽、增益和噪温来源。

当测量类型或数量不能辨识参数时，应冻结参数并返回 `UNIDENTIFIABLE_PARAMETER`。profile 序列化后必须通过 schemaVersion、confidence、condition 和 diagnostics 校验。

## 7. Replay 与数据来源

- Replay timestamp 必须是有效 ISO-8601；
- 指标必须为有限数值；
- 播放 start/stop/unmount 不得残留或重复 timer；
- live/replay series 上限为 3,600 点；
- Open-Meteo 降水标记 `observed-input`；
- 本地计算的雨衰标记 `synthetic-derived`；
- 旧 `measuredLoss` 没有来源证据时按 derived 处理并给出诊断。

## 8. NTN、DVB 与 API

- SNR 不得当 path loss；缺少 path loss 时返回 unavailable；
- DVB 表输入是 Es/N0，不能直接传 SNR；
- 低于最低 MODCOD 门限返回 outage 和 null efficiency；
- SNR 启发式建议必须标记 `heuristic-not-standard-compliant`；
- 空 MODCOD timeline 必须显示空状态；
- API 对 NaN、Infinity、越界经纬高、hours、TLE 和 link params 返回 400；
- 默认 HOST 是 `127.0.0.1`；
- WS payload 与请求频率受限。

## 9. 最终静态审计

静态搜索旧 MAT 导入函数、静态 RX 帧选择、把 SNR 当路径损耗以及从噪声底反推 C/N0 的模式；这些模式不应再出现在实现中。

```bash
rg -n "legacy.*import|\\.mat|trajectory\\.csv" src README.md Validation_Guide.md
```

如果为了说明迁移而提到旧格式，必须明确写成“已移除”，不得存在可执行导入路径。
