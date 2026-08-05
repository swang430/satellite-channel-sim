# MPDB Dynamic PDP Overlay Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 完全跟随 MPDB 接收端逐帧轨迹，在同一播放器中同步展示统计 PDP，并通过开关叠加同 frame 的 RT PDP 与拟合指标。

**Architecture:** Scenario v3 将逐帧 RX 位置正式定义为 `receiver.track`，删除未发布的 `groundSelection/groundCandidates` 契约。比较引擎对每个 MPDB frame 使用同帧 transmitter、receiver 和 RT 射线生成报告；`ChannelComparisonPanel` 只负责计算，`PdpComparisonPlayer` 在主 CIR 区域播放预计算结果。

**Tech Stack:** React 19、Chart.js / react-chartjs-2、Vitest、Scenario v3、现有 MPDB importer/comparison engine、Vite。

---

### Task 1：把 Scenario v3 收敛为逐帧 receiver track

**Files:**

- Modify: `src/domain/scenario.js`
- Modify: `src/importers/mpdb/scenarioAssembler.js`
- Modify: `tests/domain/scenario.test.js`
- Modify: `tests/importers/scenarioAssembler.test.js`

**Step 1：写 receiver track 契约的失败测试**

在 `tests/domain/scenario.test.js` 的 `validScenario` 中加入两帧 receiver track fixture，并替换 ground selection 测试：

```js
function receiverTrack(frameCount = 2) {
  return Array.from({ length: frameCount }, (_, frameId) => ({
    frameId,
    timestampUtc: `2026-08-05T00:00:0${frameId}.000Z`,
    longitude_deg: 109 + frameId * 1e-5,
    latitude_deg: 34,
    altitude_m: 349,
    projectedPosition_m: { x: frameId, y: 0, z: 349 },
  }));
}

it('requires one receiver track point per scenario frame', () => {
  const scenario = validScenario({
    time: { startTimeUtc: '2026-08-05T00:00:00.000Z', sampleInterval_s: 1, frameCount: 2 },
    receiver: { track: receiverTrack(1) },
  });

  expect(validateScenario(scenario)).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'RECEIVER_TRACK_FRAME_COUNT_MISMATCH' }),
  ]));
});

it('is ready for comparison when its receiver track is complete', () => {
  const scenario = validScenario({
    time: { startTimeUtc: '2026-08-05T00:00:00.000Z', sampleInterval_s: 1, frameCount: 2 },
    receiver: { track: receiverTrack(2) },
  });
  expect(() => assertScenarioReadyForComparison(scenario)).not.toThrow();
});
```

删除 `normalizeGroundSelection` 的 import 及相关测试。

**Step 2：运行测试并确认红灯**

Run:

```bash
npx vitest run tests/domain/scenario.test.js
```

Expected: receiver track 长度不一致尚未被拒绝，测试失败。

**Step 3：实现最终 v3 契约**

在 `createScenarioDraft` 中删除 `groundSelection` 默认字段。`validateScenario` 新增：

```js
const receiverTrack = scenario.receiver?.track;
if (!Array.isArray(receiverTrack) || receiverTrack.length !== scenario.time?.frameCount) {
  issues.push(validationIssue(
    'RECEIVER_TRACK_FRAME_COUNT_MISMATCH',
    'receiver.track',
    'receiver.track must contain exactly one point per scenario frame',
  ));
}
```

同时验证每个 track point 的 `frameId` 等于数组位置，并具有有限的经纬高和 projected xyz。删除 `normalizeGroundSelection`；`assertScenarioReadyForComparison` 只依赖 `validateScenario`。

**Step 4：写 assembler 的失败测试**

```js
expect(scenario.receiver.track).toHaveLength(2);
expect(scenario.receiver.track[0]).toMatchObject({
  frameId: 0,
  projectedPosition_m: expect.any(Object),
});
expect(scenario).not.toHaveProperty('groundSelection');
expect(scenario).not.toHaveProperty('groundCandidates');
```

Run:

```bash
npx vitest run tests/importers/scenarioAssembler.test.js
```

Expected: FAIL，assembler 仍输出旧字段。

**Step 5：修改 assembler**

把 `buildGroundCandidates` 重命名为 `buildReceiverTrack`，装配为：

```js
receiver: {
  ...config.receiver,
  track: receiverTrack,
},
```

删除 `groundSelection: null`、`scenario.groundCandidates`。保留 `geometry.rxPosition_m` 作为原始列式 provenance，不作为 UI track。

**Step 6：运行领域与 importer 测试**

Run:

```bash
npx vitest run tests/domain/scenario.test.js tests/importers/scenarioAssembler.test.js tests/importers/importMpdbBundle.test.js
```

Expected: PASS。

**Step 7：提交**

```bash
git add src/domain/scenario.js src/importers/mpdb/scenarioAssembler.js tests/domain/scenario.test.js tests/importers/scenarioAssembler.test.js
git commit -m "refactor: define MPDB receiver track in scenario v3"
```

---

### Task 2：分析接收端移动/静止状态并简化导入 UI

**Files:**

- Create: `src/features/mpdb-import/receiverTrack.js`
- Create: `tests/features/receiverTrack.test.js`
- Modify: `src/features/mpdb-import/MpdbImportPanel.jsx`
- Delete: `src/features/mpdb-import/groundSelection.js`
- Delete: `tests/features/groundSelection.test.js`

**Step 1：写 motion summary 的失败测试**

```js
import {
  receiverMotionAt,
  summarizeReceiverTrack,
} from '../../src/features/mpdb-import/receiverTrack.js';

const track = [
  { frameId: 0, projectedPosition_m: { x: 0, y: 0, z: 0 } },
  { frameId: 1, projectedPosition_m: { x: 1, y: 0, z: 0 } },
  { frameId: 2, projectedPosition_m: { x: 1.05, y: 0, z: 0 } },
];

it('classifies receiver motion from consecutive MPDB positions', () => {
  expect(receiverMotionAt(track, 0)).toMatchObject({ state: 'initial', displacement_m: 0 });
  expect(receiverMotionAt(track, 1)).toMatchObject({ state: 'moving', displacement_m: 1 });
  expect(receiverMotionAt(track, 2)).toMatchObject({ state: 'stationary', displacement_m: 0.05 });
});

it('summarizes moving and stationary receiver frames', () => {
  expect(summarizeReceiverTrack(track)).toMatchObject({
    frameCount: 3,
    movingFrameCount: 1,
    stationaryFrameCount: 1,
    totalDistance_m: 1.05,
  });
});
```

**Step 2：运行并确认红灯**

Run:

```bash
npx vitest run tests/features/receiverTrack.test.js
```

Expected: FAIL，模块不存在。

**Step 3：实现最小运动模型**

使用三维欧氏距离，默认 `stationaryThreshold_m=0.1`。验证 track 和 position 均有效；异常时抛出 `RECEIVER_TRACK_INVALID`。

**Step 4：运行并确认绿灯**

Run:

```bash
npx vitest run tests/features/receiverTrack.test.js
```

Expected: PASS。

**Step 5：修改导入面板**

删除：

- `draftFrameId`；
- ground slider、确认按钮、稳定帧建议；
- `canCompareScenario/selectGroundFrame/suggestGroundFrames`；
- 对 `onScenarioChange` 的第二次确认回调。

导入 READY 后立即提交 scenario。使用 `summarizeReceiverTrack(scenario.receiver.track)` 展示：frame 数、起终点、累计距离、moving/stationary 数和 `MPDB RX position` 来源。

**Step 6：删除旧模块并运行测试**

Run:

```bash
npx vitest run tests/features tests/importers
npm run lint
```

Expected: PASS，无 ground selection import 残留。

**Step 7：提交**

```bash
git add src/features/mpdb-import/MpdbImportPanel.jsx src/features/mpdb-import/receiverTrack.js tests/features/receiverTrack.test.js
git rm src/features/mpdb-import/groundSelection.js tests/features/groundSelection.test.js
git commit -m "feat: follow the native MPDB receiver track"
```

---

### Task 3：逐帧建立收发几何并比较全部 MPDB frame

**Files:**

- Modify: `src/geometry/scenarioGeometry.js`
- Create: `tests/geometry/scenarioGeometry.test.js`
- Modify: `src/comparison/compareScenario.js`
- Modify: `src/comparison/statisticalEnsemble.js`
- Modify: `tests/comparison/compareScenario.test.js`
- Modify: `tests/comparison/alignmentMetrics.test.js`
- Delete: `src/comparison/frameAlignment.js`

**Step 1：写逐帧 receiver geometry 的失败测试**

```js
it('uses the transmitter and receiver position from the same MPDB frame', () => {
  const scenario = scenarioFixtureWithTracks();
  const first = scenarioFrameGeometry(scenario, 0);
  const second = scenarioFrameGeometry(scenario, 1);

  expect(first.receiverPosition_m).toEqual({ x: 0, y: 0, z: 0 });
  expect(second.receiverPosition_m).toEqual({ x: 10, y: 0, z: 0 });
  expect(second.transmitterPosition_m).toEqual(
    scenario.transmitter.track[1].projectedPosition_m,
  );
});
```

再测试 receiver frame 缺失：

```js
expect(() => scenarioFrameGeometry(scenarioWithoutReceiverFrame, 1))
  .toThrowError(expect.objectContaining({ code: 'RECEIVER_TRACK_FRAME_MISSING' }));
```

**Step 2：运行并确认红灯**

Run:

```bash
npx vitest run tests/geometry/scenarioGeometry.test.js
```

Expected: FAIL，当前仍要求 groundSelection。

**Step 3：实现逐帧几何**

```js
const trackPoint = scenario.transmitter.track[frameId];
const receiverPoint = scenario.receiver.track[frameId];
if (!receiverPoint || receiverPoint.frameId !== frameId) {
  throw new DomainValidationError(
    'RECEIVER_TRACK_FRAME_MISSING',
    `Receiver track frame ${frameId} is missing`,
  );
}
```

`receiverPosition_m` 使用 `receiverPoint.projectedPosition_m`。

**Step 4：写全帧比较的失败测试**

更新 comparison fixture 为 `receiver.track`，并断言：

```js
it('compares every MPDB frame using native receiver geometry', async () => {
  const report = await compareScenario(scenarioFixture(), {
    realizationCount: 2,
    statisticalParameters: {
      environment: 'urban',
      tec_TECU: 20,
      scatterPowerOffset_dB: -2,
    },
  });

  expect(report.frames.map((frame) => frame.frameId)).toEqual([0, 1]);
  expect(report.frameCounts).toEqual({ total: 2, compared: 2 });
  expect(report.receiverGeometry).toEqual({
    mode: 'mpdb-track',
    source: 'rayTracing.rxPosition',
    frameCount: 2,
  });
  expect(report.statisticalParameters).toMatchObject({ environment: 'urban', tec_TECU: 20 });
});
```

**Step 5：运行并确认红灯**

Run:

```bash
npx vitest run tests/comparison/compareScenario.test.js
```

Expected: FAIL，当前仍筛选 exact frame 并要求 groundSelection。

**Step 6：实现全帧比较**

- 使用 `assertScenarioReadyForComparison(scenario)`；
- frameId 列表为 `0..frameCount-1`；
- 删除 `classifyScenarioFrames` 与 approximate 分支；
- `COMPARISON_MODEL_VERSION` 升为 `mpdb-statistical-comparison/v2`；
- report 写入 `receiverGeometry`、`frameCounts` 和标准化的 `statisticalParameters`；
- `runStatisticalEnsemble` 接受并传递 `scatterPowerOffset_dB`；
- progress 分母固定为 `scenario.time.frameCount`。

**Step 7：移除 frame alignment 实现和测试**

从 `alignmentMetrics.test.js` 删除 exact/approximate 用例，保留 PDP 与角度/Doppler 指标测试；删除 `frameAlignment.js`。

Run:

```bash
npx vitest run tests/geometry/scenarioGeometry.test.js tests/comparison
```

Expected: PASS。

**Step 8：提交**

```bash
git add src/geometry/scenarioGeometry.js src/comparison/compareScenario.js src/comparison/statisticalEnsemble.js tests/geometry/scenarioGeometry.test.js tests/comparison
git rm src/comparison/frameAlignment.js
git commit -m "refactor: compare every native MPDB geometry frame"
```

---

### Task 4：建立 PDP 播放 View Model 和 stale-report guard

**Files:**

- Modify: `src/features/channel-comparison/comparisonViewModel.js`
- Modify: `tests/comparison/comparisonViewModel.test.js`
- Create: `src/features/channel-comparison/comparisonReportState.js`
- Create: `tests/comparison/comparisonReportState.test.js`

**Step 1：写 RT 开关和非连续 frameId 的失败测试**

```js
it('uses one frame for every dataset and omits RT when disabled', () => {
  const frame = comparisonFrameFixture({ frameId: 8 });
  const hidden = buildComparisonFrameView(frame, { showRtOverlay: false });
  const shown = buildComparisonFrameView(frame, { showRtOverlay: true });

  expect(hidden.datasets.some((set) => set.source === 'rt')).toBe(false);
  expect(shown.datasets.some((set) => set.source === 'rt')).toBe(true);
  expect(shown.datasets.every((set) => set.frameId === 8)).toBe(true);
});

it('advances by report position instead of assuming contiguous frame IDs', () => {
  const report = { frames: [{ frameId: 3 }, { frameId: 8 }] };
  expect(nextComparisonPosition(report, 0)).toBe(1);
  expect(nextComparisonPosition(report, 1)).toBe(0);
});
```

**Step 2：写 receiver motion 摘要的失败测试**

```js
it('exposes receiver motion and fit metrics for the active frame', () => {
  const report = comparisonReportFixture();
  const summary = buildComparisonPlaybackSummary(report, 1);
  expect(summary).toMatchObject({
    frameId: 1,
    receiverMotion: 'moving',
    receiverDisplacement_m: 1,
    receiverLongitude_deg: expect.any(Number),
    receiverLatitude_deg: expect.any(Number),
  });
});
```

**Step 3：运行并确认红灯**

Run:

```bash
npx vitest run tests/comparison/comparisonViewModel.test.js
```

Expected: FAIL，新函数不存在。

**Step 4：实现纯 View Model**

新增：

- `buildComparisonFrameView(frame, { showRtOverlay })`；
- `nextComparisonPosition(report, position)`；
- `buildComparisonPlaybackSummary(report, position)`。

沿用现有相对 dB 规则。输出前校验原始统计值和所有 `{x,y}` 为有限数；异常抛出 `COMPARISON_PLOT_DATA_INVALID`。dataset 用 `source` 标识 `statistical-median/p5/p95/rt`，样式留给组件。

**Step 5：实现 report request key guard**

先写失败测试：

```js
it('accepts only the report for the current scenario and statistical parameters', () => {
  const report = { scenarioId: 'a', requestKey: 'a|urban|20|-2|32' };
  expect(currentComparisonReport(report, 'a', 'a|urban|20|-2|32')).toBe(report);
  expect(currentComparisonReport(report, 'a', 'a|rural|20|-2|32')).toBeNull();
  expect(currentComparisonReport(report, 'b', 'a|urban|20|-2|32')).toBeNull();
});
```

实现：

```js
export function currentComparisonReport(report, scenarioId, requestKey) {
  return report?.scenarioId === scenarioId && report?.requestKey === requestKey
    ? report
    : null;
}
```

request key 由纯函数按 `scenarioId/environment/tec/scatterOffset/realizationCount` 生成，禁止依赖对象属性顺序。

**Step 6：运行测试并提交**

Run:

```bash
npx vitest run tests/comparison/comparisonViewModel.test.js tests/comparison/comparisonReportState.test.js
```

Expected: PASS。

```bash
git add src/features/channel-comparison/comparisonViewModel.js src/features/channel-comparison/comparisonReportState.js tests/comparison/comparisonViewModel.test.js tests/comparison/comparisonReportState.test.js
git commit -m "feat: model synchronized MPDB PDP playback"
```

---

### Task 5：实现动态 `PdpComparisonPlayer`

**Files:**

- Create: `src/features/channel-comparison/PdpComparisonPlayer.jsx`
- Modify: `src/features/channel-comparison/comparisonViewModel.js`
- Modify: `tests/comparison/comparisonViewModel.test.js`

**Step 1：补齐 chart dataset 映射测试**

```js
it('maps semantic PDP sources to stable chart styles', () => {
  const chart = buildComparisonChartData(buildComparisonFrameView(
    comparisonFrameFixture(),
    { showRtOverlay: true },
  ));
  expect(chart.datasets.find((set) => set.source === 'statistical-median'))
    .toMatchObject({ borderColor: '#53dfc3', showLine: true });
  expect(chart.datasets.find((set) => set.source === 'rt'))
    .toMatchObject({ borderColor: '#ff665f', showLine: true });
});
```

**Step 2：运行红灯并实现映射**

Run:

```bash
npx vitest run tests/comparison/comparisonViewModel.test.js
```

Expected: FAIL，chart 映射函数不存在。

实现 `buildComparisonChartData`，P5/P95 使用半透明虚线边界，median 青色实线，RT 红色实线和点。

**Step 3：实现播放器组件**

组件要求：

- report position、播放状态、FPS 和 `showRtOverlay=true`；
- timer 只切换预计算 position，并在暂停、report 替换和卸载时清理；
- `Line` 使用 `parsing:false`、`animation:false`；
- slider 用 position，标签显示真实 frameId；
- `aria-label="RT 叠加"`；
- 展示 UTC、RX 经纬高、帧间位移、移动状态、仰角、斜距和三个拟合指标；
- 展示 `UNDEFINED_H_NORMALIZATION`。

核心：

```jsx
const frame = report.frames[position];
const view = useMemo(
  () => buildComparisonFrameView(frame, { showRtOverlay }),
  [frame, showRtOverlay],
);
const summary = useMemo(
  () => buildComparisonPlaybackSummary(report, position),
  [report, position],
);
```

**Step 4：运行定向测试、lint、build**

Run:

```bash
npx vitest run tests/comparison/comparisonViewModel.test.js
npm run lint
npm run build
```

Expected: PASS，无 Hook 或图表 warning。

**Step 5：提交**

```bash
git add src/features/channel-comparison/PdpComparisonPlayer.jsx src/features/channel-comparison/comparisonViewModel.js tests/comparison/comparisonViewModel.test.js
git commit -m "feat: add dynamic RT PDP overlay player"
```

---

### Task 6：提升 comparison report 并接入主 CIR 区域

**Files:**

- Modify: `src/features/channel-comparison/ChannelComparisonPanel.jsx`
- Modify: `src/ChannelSimPanel.jsx`
- Modify: `tests/comparison/comparisonReportState.test.js`

**Step 1：简化计算面板**

`ChannelComparisonPanel` 新签名：

```jsx
export default function ChannelComparisonPanel({
  scenario,
  requestKey,
  statisticalParameters,
  onReportChange,
})
```

行为：

- scenario receiver track 有效即可运行；
- 开始、失败和取消时 `onReportChange(null)`；
- 成功 report 写入 `requestKey` 后回调父级；
- 删除 `Line`、frame slider 和静态 PDP 图；
- 摘要只显示 total/compared、realization、模型版本和 receiver mode。

**Step 2：在父级建立当前 request**

`ChannelSimPanel` 使用当前理论参数：

```js
const statisticalParameters = useMemo(() => ({
  environment: env,
  tec_TECU: tec,
  scatterPowerOffset_dB: useCalibration && calibProfile.calibrated
    ? calibProfile.params.scatterPowerOffset_dB
    : 0,
}), [env, tec, useCalibration, calibProfile]);
```

生成 stable request key，并通过 `currentComparisonReport` 拒绝场景或参数变化后的旧报告。`handleMpdbScenarioChange` 不再把某一地面 frame 写入全局 ground station；它只设置场景并清除报告。

**Step 3：接入主 CIR 输出**

```jsx
const hasChannelOutput = timeline.length > 0 || Boolean(activeComparisonReport);

{activeComparisonReport ? (
  <PdpComparisonPlayer
    key={activeComparisonReport.requestKey}
    report={activeComparisonReport}
  />
) : timeline.length > 0 ? (
  // 保留原 CIR canvas
) : null}
```

绝对 Rx/SNR、损耗分解只属于自由运行 timeline；比较模式不得用相对 RT PDP 填充这些字段。

`onCirSyncStateChange.importInfo` 改为：

```js
{
  format: scenario.source.format,
  scenarioId: scenario.scenarioId,
  receiverGeometryMode: 'mpdb-track',
}
```

**Step 4：运行比较、lint、build**

Run:

```bash
npx vitest run tests/comparison tests/features
npm run lint
npm run build
```

Expected: PASS；无 groundSelection 引用和重复播放器。

**Step 5：提交**

```bash
git add src/features/channel-comparison/ChannelComparisonPanel.jsx src/ChannelSimPanel.jsx tests/comparison/comparisonReportState.test.js
git commit -m "feat: integrate MPDB track comparison into CIR playback"
```

---

### Task 7：扩展真实 MPDB 验收并更新文档

**Files:**

- Modify: `scripts/mpdbSampleVerification.js`
- Modify: `scripts/verify-mpdb-sample.mjs`
- Modify: `tests/scripts/mpdbSampleVerification.test.js`
- Modify: `README.md`
- Modify: `Validation_Guide.md`
- Modify: `src/UserManual.jsx`

**Step 1：写动态报告 helper 的失败测试**

```js
it('accepts a complete 179-frame MPDB-track comparison report', () => {
  const frames = Array.from({ length: 179 }, (_, frameId) => ({
    frameId,
    metrics: {
      jsDivergence_bits: 0.1,
      weightedDelayDistance_s: 10e-9,
      rmsDelaySpreadDifference_s: -2e-9,
    },
  }));
  expect(() => assertDynamicComparisonReport({ frames }, 179)).not.toThrow();
  frames[4].metrics.jsDivergence_bits = Number.NaN;
  expect(() => assertDynamicComparisonReport({ frames }, 179))
    .toThrow(/frame\[4\].jsDivergence_bits/);
});
```

**Step 2：运行红灯并实现 helper**

Run:

```bash
npx vitest run tests/scripts/mpdbSampleVerification.test.js
```

Expected: FAIL，helper 不存在。

实现时验证 frameCount、连续真实 frameId 和三个有限拟合指标。

**Step 3：扩展真实样本脚本**

无需选择 frame：

```js
const comparison = await compareScenario(scenario);
assertDynamicComparisonReport(comparison, 179);
const receiverSummary = summarizeReceiverTrack(scenario.receiver.track);
```

输出：

```js
dynamicComparison: {
  status: 'passed',
  receiverGeometryMode: comparison.receiverGeometry.mode,
  comparedFrameCount: comparison.frames.length,
  realizationCount: comparison.realizationCount,
  movingFrameCount: receiverSummary.movingFrameCount,
  stationaryFrameCount: receiverSummary.stationaryFrameCount,
}
```

**Step 4：运行真实三文件验收**

Run:

```bash
node scripts/verify-mpdb-sample.mjs \
  "/Users/simon/Tools/satellite-channel-sim/MPDB/星地仿真项目_2026-08-04_17_08_42_MPDB.zip" \
  "/Users/simon/Tools/satellite-channel-sim/MPDB/星地仿真-20260805-184931-base-station-config.json" \
  "/Users/simon/Tools/satellite-channel-sim/MPDB/星地仿真-20260805-184931-terminal-config.json"
```

Expected: 179 comparison frames、32 realizations、`mpdb-track`，且改名导入与错配拒绝仍通过。

**Step 5：更新三处用户文档**

删除所有“必须选择静态 ground frame”和 exact/approximate 默认比较说明。新增：

- 全程跟随 MPDB RX track；
- 移动段与静止段均按原始位置播放；
- 固定点比较必须导入 Lauraycs 固定终端 MPDB；
- RT 叠加开关、颜色、P5–P95 和真实 frameId；
- 两条 PDP 各自峰值归一化，RT 绝对功率 unavailable。

Run:

```bash
rg -n "groundSelection|静态地面帧|exact/approximate" src README.md Validation_Guide.md
```

Expected: 无旧产品语义命中；若测试 fixture 使用旧词，必须已删除或改写。

**Step 6：运行测试并提交**

```bash
npx vitest run tests/scripts/mpdbSampleVerification.test.js
git add scripts README.md Validation_Guide.md src/UserManual.jsx tests/scripts/mpdbSampleVerification.test.js
git commit -m "docs: verify and explain MPDB track playback"
```

---

### Task 8：全量验证和本地 UI 联调

**Files:**

- Modify only if verification exposes a defect.

**Step 1：静态审计旧模式**

Run:

```bash
rg -n "groundSelection|groundCandidates|selectGroundFrame|classifyScenarioFrames" src tests scripts README.md Validation_Guide.md
```

Expected: 无命中。设计/历史计划文档不在本次可执行源码审计范围。

**Step 2：完整验证**

Run:

```bash
npm run verify
```

Expected: 所有 Vitest 与物理回归通过，lint 零错误，build 无 warning。

**Step 3：重复真实 MPDB 验收**

运行 Task 7 三文件命令。

Expected: 179 帧动态比较和所有既有样本检查通过。

**Step 4：短时启动 UI/API**

Run:

```bash
PORT=3222 npm run full
```

Expected: API 与 Vite 启动；确认后发送 SIGINT，并检查实际端口无残留。

**Step 5：UI 验收**

1. 导入真实 MPDB 三文件，不出现 ground frame 选择器；
2. 导入摘要显示完整 receiver track；
3. 运行比较后主 CIR 卡片进入 MPDB track 模式；
4. 播放完整 179 帧，前段 RX 坐标移动、后段变为静止；
5. 关闭 RT 叠加后仅显示统计 median/P5/P95；
6. 开启后同 frame 红色 RT PDP 出现；
7. 改变环境、TEC、校准散射偏移或重新导入场景后旧报告消失。

**Step 6：只在验收产生修复时提交**

```bash
git add <修复文件>
git commit -m "fix: complete MPDB track overlay verification"
```

无修改则不创建空提交。
