# Unified Statistical / RT PDP Playback Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 用一个时间窗口驱动的 PDP 播放器覆盖独立统计仿真和 MPDB RT 叠加对比。

**Architecture:** 将 TLE 过顶时间线适配成与 MPDB comparison report 兼容的 playback report。`PdpComparisonPlayer` 只消费该统一结构，统计图层必选，RT 图层可选。

**Tech Stack:** React 19、Chart.js/react-chartjs-2、Vitest/happy-dom、现有 SGP4 与 statistical CIR ensemble。

---

### Task 1: 统计播放报告适配器

**Files:**
- Create: `src/features/channel-comparison/statisticalPlaybackReport.js`
- Test: `tests/comparison/statisticalPlaybackReport.test.js`
- Modify: `src/comparison/statisticalEnsemble.js`
- Test: `tests/comparison/statisticalEnsemble.test.js`

1. 先写失败测试：TLE timeline 每帧产生 32-realization median/P5/P95、统计指标摘要和 `selected-pass` 窗口。
2. 运行 `npx vitest run tests/comparison/statisticalPlaybackReport.test.js tests/comparison/statisticalEnsemble.test.js`，确认因适配器/指标摘要缺失而失败。
3. 实现纯适配函数和 ensemble metric summary，保持 seed 确定性。
4. 重跑目标测试至通过。

### Task 2: 通用 PDP view model 与播放器

**Files:**
- Modify: `src/features/channel-comparison/comparisonViewModel.js`
- Modify: `src/features/channel-comparison/PdpComparisonPlayer.jsx`
- Test: `tests/comparison/comparisonViewModel.test.js`
- Test: `tests/comparison/PdpComparisonPlayer.test.js`

1. 先写失败测试：无 RT 报告仅显示统计图层、窗口元数据和统计指标，不出现 RT 开关或 MPDB 文案。
2. 确认新测试因 view model 强制 RT 而失败。
3. 将 RT series、RT normalization 和拟合指标改为可选；增加窗口概要和统计指标展示。
4. 运行目标测试，确认统计与 MPDB 两种 report 都通过。

### Task 3: 时间窗口优先的 ChannelSimPanel

**Files:**
- Modify: `src/ChannelSimPanel.jsx`
- Test: `tests/comparison/ChannelSimPanel.test.js`

1. 先写失败测试：过顶搜索不自选；选中后自动生成并显示统计 PDP；导入 MPDB 后同一播放器增加 RT。
2. 确认测试因当前默认选中第一过顶且统计 Canvas 与 MPDB 播放器互斥而失败。
3. 自动搜索但不选择窗口；选择或参数变化时构建 timeline 和统计 playback report。
4. 以 MPDB report 优先、TLE 统计 report 回退的方式渲染同一 `PdpComparisonPlayer`，移除主区的 taps Canvas。
5. 运行 ChannelSimPanel 目标测试至通过。

### Task 4: 回归、文档和真实数据

**Files:**
- Modify: `README.md`
- Modify: `Validation_Guide.md`
- Modify: `src/UserManual.jsx`

1. 运行 `npm run verify`，修复所有回归。
2. 运行 `scripts/verify-mpdb-sample.mjs` 验证 179 帧真实 MPDB。
3. 本地浏览器验证窗口选择、统计播放、MPDB RT 开关和时间轴保持。
4. 更新用户文档并提交变更。
