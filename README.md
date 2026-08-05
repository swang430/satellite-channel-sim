# 卫星信道仿真与 MPDB 对比系统

这是一个面向星地链路工程分析的 Web 仿真器。系统把轨道、地面站、链路参数、Lauraycs MPDB 射线结果、统计信道和校准数据统一到带单位与来源信息的数据契约中。

当前场景 Schema：`satellite-channel-sim/scenario-v3`。

## 功能概览

- SGP4/TLE 轨道传播、过境搜索、地面轨迹和天空图。
- 雨衰、气体、云雾、电离层、极化和接收机噪声链路预算。
- 可复现的统计 CIR/PDP、时延扩展、相干带宽和多普勒计算。
- Lauraycs MPDB 三文件导入及 RT—统计模型比较。
- 有可辨识性诊断的地面测量校准。
- Historical Replay、天气观测输入和模型派生损耗展示。
- REST/WebSocket 链路状态接口、NTN 和 DVB-S2X adapter。

## 安装与验证

需要 Node.js 20 或更高版本。

```bash
npm ci
npm run dev       # Web UI
npm run api       # 默认 127.0.0.1:3001
npm run full      # 同时启动 UI 与 API
npm run verify    # Vitest + 物理回归 + lint + production build
```

如需让 API 监听所有网卡，必须显式配置：

```bash
HOST=0.0.0.0 npm run api
```

## MPDB 导入

点击信道面板中的“加载 MPDB / RT 比较工具”，一次选择三个文件：

1. Lauraycs MPDB `.zip`；
2. base station 配置 JSON；
3. terminal 配置 JSON。

文件名不参与识别。系统根据 ZIP/JSON 内容识别角色，因此重命名文件不会破坏关联。导入过程在 Web Worker 中完成，并检查：

- 配置类型、版本、仿真时间窗和采样间隔；
- 发射端、接收端、卫星 ID 和链路方向；
- MPDB 列、dtype、shape、storage 长度和 frame offsets；
- frame ID、射线数量、载频与带宽；
- MPDB 局部坐标到 WGS84/ECEF 的拟合残差。

导入成功后，系统直接使用 MPDB 的原生接收机轨迹。每个 frame 都以同一索引下的卫星位置、接收机位置、RT 射线和统计模型几何进行比较：MPDB 中接收机移动时按移动位置播放，静止时按静止位置播放。UI 不会把某一帧冻结成全程地面点；如果需要比较固定点，应先让 Lauraycs 生成固定终端 MPDB，再导入本系统。

## RT 与统计模型比较

三项输入的关联不依赖文件名，而是依据：

- 内容寻址的 `scenarioId`；
- JSON 内容中的配置角色、实体身份和仿真时间窗；
- MPDB `frameId`、列式 `frameOffsets` 以及逐帧索引。

配置身份或仿真时间窗错配会被拒绝。统计模型对每个 MPDB frame 默认运行固定 32 个确定性 seed 的 realization，报告中位数、P5 和 P95。导入 MPDB 后会自动生成统计基线；环境、TEC 或已启用校准 profile 中的 `scatterPowerOffset_dB` 发生变化时，统计基线会自动刷新。刷新期间保留上一版统计 PDP 作为可见基础层，但禁用 RT 叠加和拟合指标，直到当前参数的报告完成。

主 CIR 播放器逐帧显示真实 frameId、UTC、接收机经纬高、移动/静止状态、帧间位移、仰角、斜距，以及 Jensen–Shannon divergence、加权时延距离和 RMS 时延扩展差。统计中位数为青色，P5/P95 为区间边界；红色 RT PDP 叠加开关默认开启，可关闭以单独查看统计结果。

### PDP 定义

- 以该帧最早到达路径为 excess-delay 零点；
- 默认 10 ns 分箱；
- 同一 bin 内先对复振幅相干求和，再计算功率；
- RT 和统计模型使用相同的相对 PDP 定义，并分别按各自峰值归一化。

MPDB 的复系数 `H` 没有给出可追溯的绝对功率归一化。因此 RT 绝对功率始终报告：

```text
status: unavailable
reason: UNDEFINED_H_NORMALIZATION
```

因此播放器只用于比较 PDP 形状和时延结构，不代表绝对功率拟合。系统不会通过常数偏移伪造 RT 接收功率、SNR 或路径损耗。

## 统计信道与几何

统一几何模块负责 ECI/ECEF 变换、地面站位置、视线方向、仰角、斜距、速度和多普勒。ECEF 速度包含地球自转项：

```text
v_ecf = R · v_eci - ω × r_ecf
```

GEO、MEO 和 LEO 都使用真实斜距；不存在以 LEO 距离替换 GEO 距离的回退。低于地平线的帧不会作为有效接触输出。

## 地面校准

校准 profile 使用 `satellite-channel-sim/calibration-v1`，并持久化到版本化 localStorage key。

每个测量点应提供：

- `timestamp` 或 `frameId`；
- `elevation_deg`；
- `slantRange_km`；
- `rainRate_mmph`（如适用）；
- 至少一个明确单位的测量指标。

常用指标：

| 字段 | 定义 |
|---|---|
| `cn0_dBHz` | C/N0，dB-Hz |
| `cn_dB` | 带宽积分后的 C/N，dB |
| `snr_dB` | SNR，dB |
| `rssi_dBm` | 接收功率，dBm |
| `xpd_dB` | 交叉极化鉴别度，dB |
| `attenuation_dB` | 大气衰减，dB |
| `scatterPower_dB` | 相对散射功率，dB |

校准不会在缺少斜距时回退到 GEO 35786 km。数据不足以区分参数时，该参数保持 frozen，并产生 `UNIDENTIFIABLE_PARAMETER`，不会输出虚假置信区间。旧字段由 adapter 显式转换并记录单位假设。

## Historical Replay 与天气

Historical Replay 用指定时间窗重新计算轨道几何和统计信道，用于分析仰角、斜距、FSPL、大气损耗和信道指标随时间的变化；它不是 RT 测量回放。

天气 JSON Replay 接受带 ISO-8601 时间戳的帧：

```json
{
  "frames": [{
    "frameId": 0,
    "timestampUtc": "2026-08-05T00:00:00Z",
    "observation": { "rainRate_mmph": 3.2 },
    "derived": { "rainAttenuation_dB": 0.35 }
  }]
}
```

Open-Meteo 仅提供降水观测输入。由本地模型计算的雨衰标记为 `synthetic-derived`，不称为 measurement。实时和回放序列最多保留 3,600 点，停止或卸载时会清理 timer。

## Adapter 与 API 语义

- NTN adapter 在没有输入路径损耗时返回 `PATH_LOSS_NOT_PROVIDED`，不从 SNR 推导路径损耗。
- DVB-S2X 表只接受明确的 Es/N0；低于最低门限返回 outage。
- Oracle 只有 SNR 时，MODCOD 输出标记 `heuristic-not-standard-compliant`。
- API 拒绝 NaN、Infinity、越界经纬度/高度、非法 TLE 和超范围时间窗。
- WebSocket 请求最大 16 KiB，每个连接每秒最多一次请求。

## 本地 MPDB 样本验收

用户数据不应加入 Git。通过显式绝对路径运行：

```bash
node scripts/verify-mpdb-sample.mjs \
  /absolute/path/to/MPDB.zip \
  /absolute/path/to/base-station-config.json \
  /absolute/path/to/terminal-config.json
```

脚本验证 179 帧、465,512 条射线、24.95 GHz 和小于 0.05 m 的坐标 RMS 残差；随后按原生接收机轨迹完成 179 帧、每帧 32 次 realization 的动态比较，检查三项拟合指标均为有限值，并输出移动/静止帧统计。脚本还验证输入文件重命名不改变 `scenarioId`，且配置身份错配会被拒绝。

## 代码结构

```text
src/domain/             Schema 与结构化诊断
src/importers/mpdb/     安全 Pickle、PyTorch ZIP 和 MPDB 列式解析
src/workers/            浏览器 MPDB 导入 Worker
src/channel/            CIR、PDP 和信道指标
src/geometry/           坐标、链路几何和多普勒
src/calibration/        测量 adapter、校准引擎和 profile 存储
src/comparison/         RT—统计模型对齐与指标
src/replay/             Replay Schema、天气来源和有界序列
src/features/           按需加载的功能界面
server/                 REST/WebSocket API 与输入校验
tests/                  Vitest 自动化测试
```

详细物理与验收规则见 [Validation_Guide.md](./Validation_Guide.md)。许可证见 [LICENSE](./LICENSE)。
