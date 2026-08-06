# Unified Channel Playback Analytics Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 selected-pass 与 MPDB 播放中始终保留统计链路分析，并为 RT 增加定义明确的相对总增益、Doppler 质心、Doppler 扩展和同步趋势展示。

**Architecture:** 先在 comparison 层生成逐帧的统计链路预算、RT 合成指标和全窗口参考值，再用纯 `PlaybackFrameAnalytics` 适配器统一 selected-pass 与 MPDB report。播放器只消费统一 analytics；Loss Breakdown、Frame Details 和趋势图不再直接读取 TLE timeline。

**Tech Stack:** React 19、Chart.js/react-chartjs-2、Vitest/happy-dom、现有 statistical CIR、Lauraycs MPDB typed arrays、确定性 comparison report。

---

### Task 1: RT 总功率与 Doppler 合成数学核心

**Files:**
- Modify: `src/comparison/comparisonMetrics.js`
- Test: `tests/comparison/alignmentMetrics.test.js`

**Step 1: 写失败测试**

用手算数据覆盖功率加权 Doppler 质心、RMS spread、最强径 Doppler、范围、主径占比和零总功率：

```js
it('summarizes terminal-effective RT Doppler without collapsing its spread', () => {
  const result = summarizeRtPathStatistics({
    hReal: new Float32Array([1, 2]),
    hImag: new Float32Array([0, 0]),
    doppler_Hz: new Float32Array([100, 300]),
    aoa_deg: new Float32Array([0, 90]),
    aod_deg: new Float32Array([10, 30]),
    channelType: new Int16Array([1, 2]),
  });

  expect(result.dopplerCentroid_Hz).toBe(260);
  expect(result.dopplerRmsSpread_Hz).toBe(80);
  expect(result.dominantPathDoppler_Hz).toBe(300);
  expect(result.dominantPathPowerShare).toBe(0.8);
  expect(result.dopplerMin_Hz).toBe(100);
  expect(result.dopplerMax_Hz).toBe(300);
  expect(result.dopplerMethod).toBe('noncoherent-path-power-weighted');
});
```

再增加 `summarizeRtWindowRelativeGain` 测试，输入每帧已按 delay bin 合成的 `totalPower_linear`，验证相对窗口峰值和相对首帧 dB；零功率返回明确 unavailable 状态，不返回 `Infinity` 或 `NaN`。

**Step 2: 确认 RED**

Run:

```bash
npx vitest run tests/comparison/alignmentMetrics.test.js
```

Expected: FAIL，因为 Doppler spread、主径字段和窗口相对增益函数尚不存在。

**Step 3: 最小实现**

在 `comparisonMetrics.js` 中以 `|H|²` 作为每条射线权重：

```js
const centroid = weightedSum / totalPower;
const variance = dopplers.reduce((sum, value, index) => (
  sum + weights[index] * (value - centroid) ** 2
), 0) / totalPower;

return {
  dopplerCentroid_Hz: centroid,
  dopplerRmsSpread_Hz: Math.sqrt(Math.max(0, variance)),
  dominantPathDoppler_Hz: dopplers[dominantIndex],
  dominantPathPowerShare: weights[dominantIndex] / totalPower,
  dopplerMin_Hz: Math.min(...dopplers),
  dopplerMax_Hz: Math.max(...dopplers),
  dopplerMethod: 'noncoherent-path-power-weighted',
};
```

窗口相对增益必须使用 RT PDP 的 `metrics.totalPower_linear`，即 bin 内相干、bin 间功率求和后的结果。

**Step 4: 确认 GREEN**

Run:

```bash
npx vitest run tests/comparison/alignmentMetrics.test.js tests/comparison/rtChannelAdapter.test.js
```

Expected: PASS。

**Step 5: 提交**

```bash
git add src/comparison/comparisonMetrics.js tests/comparison/alignmentMetrics.test.js
git commit -m "feat: synthesize RT Doppler and relative gain"
```

### Task 2: 逐几何帧统计链路预算

**Files:**
- Create: `src/comparison/statisticalFrameAnalytics.js`
- Test: `tests/comparison/statisticalFrameAnalytics.test.js`
- Modify: `src/features/channel-comparison/statisticalPlaybackReport.js`
- Modify: `tests/comparison/statisticalPlaybackReport.test.js`

**Step 1: 写失败测试**

测试纯函数 `buildStatisticalFrameAnalytics`：给定载频、带宽、仰角、斜距和当前链路参数，返回完整 loss breakdown、总传播损耗、Rx、噪底、SNR、delay metrics 与字段来源。

```js
expect(result.loss).toMatchObject({
  method: 'statistical-link-budget/v1',
  fspl_dB: expect.any(Number),
  totalPropagationLoss_dB: expect.any(Number),
  components_dB: {
    rain: expect.any(Number),
    gas: expect.any(Number),
    cloud: expect.any(Number),
    shadow: expect.any(Number),
    faraday: expect.any(Number),
    pointing: expect.any(Number),
    scan: expect.any(Number),
    multipath: expect.any(Number),
    scintillation: expect.any(Number),
  },
});
expect(result.loss.totalPropagationLoss_dB).toBeCloseTo(
  result.loss.fspl_dB
    + Object.values(result.loss.components_dB).reduce((sum, value) => sum + value, 0),
  10,
);
```

再测试 selected-pass adapter 会把已有 timeline 链路数据写入同一结构，并保留原 `dopplerHz`。

**Step 2: 确认 RED**

```bash
npx vitest run tests/comparison/statisticalFrameAnalytics.test.js tests/comparison/statisticalPlaybackReport.test.js
```

Expected: FAIL，因为新适配器和 report 字段不存在。

**Step 3: 最小实现**

复用 `calculateLinkBudget` 与 `calculateMIMOCapacity`，但强制使用 report/scenario 的载频、带宽和当前帧几何。不得把 EIRP 或天线增益计入 `totalPropagationLoss_dB`。

selected-pass 直接适配 timeline 已有字段，避免重复计算导致旧结果数值变化：

```js
frame.statistical.linkBudget = analytics;
frame.statistical.doppler = {
  geometric_Hz: frame.dopplerHz,
  method: 'sgp4-range-rate',
};
```

**Step 4: 确认 GREEN**

```bash
npx vitest run tests/comparison/statisticalFrameAnalytics.test.js tests/comparison/statisticalPlaybackReport.test.js
```

Expected: PASS。

**Step 5: 提交**

```bash
git add src/comparison/statisticalFrameAnalytics.js tests/comparison/statisticalFrameAnalytics.test.js src/features/channel-comparison/statisticalPlaybackReport.js tests/comparison/statisticalPlaybackReport.test.js
git commit -m "feat: attach statistical link analytics to playback frames"
```

### Task 3: MPDB report 增加统计预算、几何 Doppler 与 RT 窗口参考

**Files:**
- Modify: `src/comparison/compareScenario.js`
- Modify: `tests/comparison/compareScenario.test.js`
- Modify: `src/features/channel-comparison/comparisonReportState.js`
- Modify: `tests/comparison/comparisonReportState.test.js`
- Modify: `src/features/channel-comparison/ChannelComparisonPanel.jsx`
- Modify: `tests/comparison/ChannelComparisonPanel.test.js`
- Modify: `src/ChannelSimPanel.jsx`

**Step 1: 写失败测试**

测试 `compareScenario` 每帧包含：

```js
expect(report.frames[0]).toMatchObject({
  statistical: {
    linkBudget: expect.any(Object),
    doppler: {
      geometric_Hz: expect.any(Number),
      method: 'mpdb-range-finite-difference',
    },
  },
  rt: {
    relativeGain: {
      relativeToWindowPeak_dB: expect.any(Number),
      relativeToFirstFrame_dB: expect.any(Number),
      absolutePathLoss: {
        status: 'unavailable',
        reason: 'UNDEFINED_H_NORMALIZATION',
      },
    },
  },
});
```

使用 3 帧已知斜距验证中心差分：

```js
const radialVelocity_mps = (range2 - range0) / (time2 - time0);
const expectedHz = -(carrierHz / 299_792_458) * radialVelocity_mps;
expect(report.frames[1].statistical.doppler.geometric_Hz).toBeCloseTo(expectedHz, 10);
```

测试 comparison request key 包含雨率、EIRP、Rx gain、噪声温度、带宽、快衰落开关和会影响 loss breakdown 的校准字段，参数变化必须触发统计报告刷新。

**Step 2: 确认 RED**

```bash
npx vitest run tests/comparison/compareScenario.test.js tests/comparison/comparisonReportState.test.js tests/comparison/ChannelComparisonPanel.test.js
```

Expected: FAIL，缺少 link analytics、几何 Doppler、relative gain 和 link-budget request 参数。

**Step 3: 最小实现**

`compareScenario` 新增 `linkBudgetParameters` 参数。先生成所有 frame geometry，再通过 UTC 间隔和 slant range 求 range rate；首尾单边差分、中间中心差分。随后调用 Task 1/2 的纯函数。

将以下参数从 `ChannelSimPanel` 传入 comparison request 和 panel：

```js
{
  eirp_dBW: eirp,
  receiverGain_dBi: gRx,
  receiverNoiseTemperature_K: tRx,
  rainRate_mmph: rainRate,
  disableFastFading,
  environment: env,
  tec_TECU: tec,
  calibration: appliedCalibrationSnapshot,
}
```

MPDB `carrier.frequency_Hz` 和 `carrier.bandwidth_Hz` 始终覆盖 UI 载频/带宽。

**Step 4: 确认 GREEN**

```bash
npx vitest run tests/comparison/compareScenario.test.js tests/comparison/comparisonReportState.test.js tests/comparison/ChannelComparisonPanel.test.js tests/comparison/ChannelSimPanel.test.js
```

Expected: PASS。

**Step 5: 提交**

```bash
git add src/comparison/compareScenario.js tests/comparison/compareScenario.test.js src/features/channel-comparison/comparisonReportState.js tests/comparison/comparisonReportState.test.js src/features/channel-comparison/ChannelComparisonPanel.jsx tests/comparison/ChannelComparisonPanel.test.js src/ChannelSimPanel.jsx
git commit -m "feat: enrich MPDB comparison with link and Doppler analytics"
```

### Task 4: 统一 PlaybackFrameAnalytics view model

**Files:**
- Create: `src/features/channel-comparison/playbackAnalytics.js`
- Test: `tests/comparison/playbackAnalytics.test.js`
- Modify: `src/features/channel-comparison/comparisonViewModel.js`
- Modify: `tests/comparison/comparisonViewModel.test.js`

**Step 1: 写失败测试**

为 selected-pass 和 MPDB fixture 分别调用 `buildPlaybackAnalytics(report)`，要求两者返回相同顶层字段。验证 RT 缺失时统计字段仍完整且 `rt.availability.status === 'not-imported'`。

测试 MPDB analytics 同时包含：

- 几何和接收机运动。
- 统计 loss/link/delay/doppler。
- RT relative gain/delay/doppler/path count。
- comparison metrics。
- `RT_ABSOLUTE_PATH_LOSS_UNAVAILABLE` alert。

**Step 2: 确认 RED**

```bash
npx vitest run tests/comparison/playbackAnalytics.test.js tests/comparison/comparisonViewModel.test.js
```

Expected: FAIL，因为统一 view model 不存在。

**Step 3: 最小实现**

`buildPlaybackAnalytics` 只做 schema 适配和校验，不重新扫描 MPDB rays：

```js
export function buildPlaybackAnalytics(report) {
  return {
    scenarioId: report.scenarioId,
    timeWindow: report.timeWindow,
    frames: report.frames.map((frame, position) => normalizeAnalyticsFrame(
      report,
      frame,
      position,
    )),
  };
}
```

`buildComparisonPlaybackFrames` 把对应 analytics frame 挂到现有 `{ chartData, summary }` 上，保持 PDP 接口兼容。

**Step 4: 确认 GREEN**

```bash
npx vitest run tests/comparison/playbackAnalytics.test.js tests/comparison/comparisonViewModel.test.js
```

Expected: PASS。

**Step 5: 提交**

```bash
git add src/features/channel-comparison/playbackAnalytics.js tests/comparison/playbackAnalytics.test.js src/features/channel-comparison/comparisonViewModel.js tests/comparison/comparisonViewModel.test.js
git commit -m "feat: add unified playback frame analytics"
```

### Task 5: 常驻 Loss Breakdown、Frame Details 与同步趋势图

**Files:**
- Create: `src/features/channel-comparison/ChannelAnalyticsPanels.jsx`
- Create: `src/features/channel-comparison/ChannelTrendCharts.jsx`
- Test: `tests/comparison/ChannelAnalyticsPanels.test.js`
- Test: `tests/comparison/ChannelTrendCharts.test.js`
- Modify: `src/features/channel-comparison/PdpComparisonPlayer.jsx`
- Modify: `tests/comparison/PdpComparisonPlayer.test.js`
- Modify: `src/App.jsx`

**Step 1: 写失败测试**

测试 selected-pass 渲染时始终出现：

- Statistical Total Loss。
- Loss Breakdown 全部分项。
- Geometry、Link、Delay、Doppler 四组 Frame Details。
- RT 字段显示“未导入”。

测试 MPDB 渲染后上述统计字段仍存在，并补充：

- RT Relative Gain。
- RT Doppler Centroid / RMS Spread / Dominant Path。
- RT absolute path loss unavailable 告警。

趋势图 mock 应接收到同一 frameCount，并以 active position 生成当前帧游标；RT 不存在时仍渲染统计总路损和统计 Doppler。

**Step 2: 确认 RED**

```bash
npx vitest run tests/comparison/ChannelAnalyticsPanels.test.js tests/comparison/ChannelTrendCharts.test.js tests/comparison/PdpComparisonPlayer.test.js
```

Expected: FAIL，新组件和常驻分析尚不存在。

**Step 3: 最小实现**

`PdpComparisonPlayer` 已拥有 active position，因此由它把 `activeFrame.analytics` 与全窗口 analytics 传给新组件，避免多个独立播放索引。

Loss Breakdown 使用汇总 + 水平分项，不把 FSPL 与小损耗放在同一个普通柱轴。负 multipath gain 使用单独颜色并保留符号。

Doppler 趋势数据集：

```js
[
  { label: 'Stat geometric Doppler', data: statDoppler },
  { label: 'RT Doppler centroid', data: rtCentroid },
  { label: 'RT centroid + RMS', data: rtUpper, fill: '+1' },
  { label: 'RT centroid - RMS', data: rtLower },
]
```

在 `App.jsx` 注册 Chart.js `Filler`，消除当前 fill plugin warning。RT 不存在时不创建 RT 数据集。

**Step 4: 确认 GREEN**

```bash
npx vitest run tests/comparison/ChannelAnalyticsPanels.test.js tests/comparison/ChannelTrendCharts.test.js tests/comparison/PdpComparisonPlayer.test.js
```

Expected: PASS，happy-dom 控制台无新增错误。

**Step 5: 提交**

```bash
git add src/features/channel-comparison/ChannelAnalyticsPanels.jsx src/features/channel-comparison/ChannelTrendCharts.jsx tests/comparison/ChannelAnalyticsPanels.test.js tests/comparison/ChannelTrendCharts.test.js src/features/channel-comparison/PdpComparisonPlayer.jsx tests/comparison/PdpComparisonPlayer.test.js src/App.jsx
git commit -m "feat: show synchronized channel analytics during playback"
```

### Task 6: PDP bin tooltip 与旧面板迁移

**Files:**
- Modify: `src/channel/pdp.js`
- Modify: `src/comparison/rtChannelAdapter.js`
- Modify: `src/features/channel-comparison/comparisonViewModel.js`
- Modify: `src/features/channel-comparison/PdpComparisonPlayer.jsx`
- Modify: `src/ChannelSimPanel.jsx`
- Test: `tests/channel/pdp.test.js`
- Test: `tests/comparison/rtChannelAdapter.test.js`
- Test: `tests/comparison/comparisonViewModel.test.js`
- Test: `tests/comparison/ChannelSimPanel.test.js`

**Step 1: 写失败测试**

测试 RT PDP bin 保留 `pathCount`，并增加 bin 内 Doppler 质心、RMS spread、AoA/AoD。测试 chart point metadata 可由 tooltip callback 读取。

测试 `ChannelSimPanel` 不再包含旧的 `showAnalyticsPanels` 互斥条件和直接基于 `timeline[cirIdx]` 的 Loss Breakdown/Frame Details；导入 MPDB 前后只存在一套分析面板。

**Step 2: 确认 RED**

```bash
npx vitest run tests/channel/pdp.test.js tests/comparison/rtChannelAdapter.test.js tests/comparison/comparisonViewModel.test.js tests/comparison/ChannelSimPanel.test.js
```

Expected: FAIL，bin metadata 和迁移尚未完成。

**Step 3: 最小实现**

在 `rtFrameToPdp` 建 bin 时保存原始 ray-to-bin 聚合统计，或在一次 frame scan 中建立对应 Map；不得为 tooltip 再次扫描整个 MPDB window。

Chart point 保留：

```js
{
  x,
  y,
  pointRole: 'tap',
  metadata: {
    pathCount,
    dopplerCentroid_Hz,
    dopplerRmsSpread_Hz,
    meanAoa_deg,
    meanAod_deg,
  },
}
```

删除 `ChannelSimPanel` 中旧 Rx/SNR chart、Loss Breakdown、Frame Details 的条件渲染和重复数据构造；CSV/JSON 导出不在本任务中改变。

**Step 4: 确认 GREEN**

```bash
npx vitest run tests/channel/pdp.test.js tests/comparison/rtChannelAdapter.test.js tests/comparison/comparisonViewModel.test.js tests/comparison/ChannelSimPanel.test.js
```

Expected: PASS。

**Step 5: 提交**

```bash
git add src/channel/pdp.js src/comparison/rtChannelAdapter.js src/features/channel-comparison/comparisonViewModel.js src/features/channel-comparison/PdpComparisonPlayer.jsx src/ChannelSimPanel.jsx tests/channel/pdp.test.js tests/comparison/rtChannelAdapter.test.js tests/comparison/comparisonViewModel.test.js tests/comparison/ChannelSimPanel.test.js
git commit -m "refactor: unify playback analytics panels and RT tooltips"
```

### Task 7: 文档、全量验证与真实 MPDB 验收

**Files:**
- Modify: `README.md`
- Modify: `Validation_Guide.md`
- Modify: `src/UserManual.jsx`

**Step 1: 更新文档**

记录：

- 统计分析始终保留。
- RT Doppler 质心/RMS/最强径定义。
- RT relative gain 合成公式。
- RT absolute path loss unavailable 的原因。
- 趋势图、Loss Breakdown 和 Frame Details 与播放器同步。

**Step 2: 运行目标回归**

```bash
npx vitest run tests/comparison
```

Expected: comparison 测试全部通过。

**Step 3: 运行完整验证**

```bash
npm run verify
```

Expected: 单元测试、物理回归、ESLint 和生产构建全部通过。

**Step 4: 运行真实数据验收**

```bash
node scripts/verify-mpdb-sample.mjs \
  "MPDB/星地仿真项目_2026-08-04_17_08_42_MPDB.zip" \
  "MPDB/星地仿真-20260805-184931-base-station-config.json" \
  "MPDB/星地仿真-20260805-184931-terminal-config.json"
```

Expected: 179 帧、465512 射线、32 realizations 比较通过；输出增加有限 Doppler 与 relative gain 摘要。

**Step 5: 浏览器验收**

使用 Playwright：

1. selected-pass：确认统计总路损、Doppler、Loss Breakdown、Frame Details 和趋势图完整。
2. 导入真实 MPDB：确认统计面板不消失，RT relative gain/Doppler 出现，绝对路损告警存在。
3. 播放和拖动 slider：所有面板 frame ID、UTC 和游标同步。
4. RT 开关只隐藏 PDP RT 线束，不隐藏 RT analytics 数据；若产品决定开关联动 analytics，必须先新增明确测试。
5. 控制台 0 error，Chart.js Filler warning 消失。

**Step 6: 提交**

```bash
git add README.md Validation_Guide.md src/UserManual.jsx
git commit -m "docs: explain unified channel playback analytics"
```

**Step 7: 完成前检查**

```bash
git status --short
git diff --check origin/main...HEAD
```

Expected: 工作区干净，diff check 无输出。推送与 GitHub Pages 部署必须由用户明确授权或遵循当前已授权的发布指令。
