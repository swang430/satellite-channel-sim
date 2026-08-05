# MPDB Schema v3 与全仓库修复实施计划

> **执行要求：** 开始实现前必须调用 `using-git-worktrees`；执行本计划时使用 `executing-plans`，每个行为变更严格按 `test-driven-development` 的 RED → GREEN → REFACTOR 顺序完成，宣称完成前调用 `verification-before-completion`。

**目标：** 用安全、内容寻址的 Lauraycs MPDB 导入和 `UnifiedScenario v3` 取代旧 `.mat` 文件名握手，建立可复现的 RT/统计比较，并修复已确认的物理、校准、API、回放、质量和结构问题。

**架构：** MPDB 与两个配置由共享 JavaScript 解析核心在 Web Worker 中解析，生成带来源和单位的 `UnifiedScenario v3`；RT 和统计模型统一映射为 `ChannelFrame`，再由独立比较引擎计算 PDP 与统计指标。浏览器、历史回放和 Node API 共用领域模块，不复制物理公式。

**技术栈：** React 19、Vite 7、JavaScript ESM、JSZip、TypedArray、Web Worker、proj4、Vitest、ESLint、Node HTTP/WS。

**数据策略：** `MPDB/` 中的用户样本不自动加入提交。自动测试使用程序生成的小型安全 fixture；本地验收脚本对用户样本验证 179 帧、465,512 射线、24.95 GHz 和坐标残差。

---

## 准备：隔离工作区

1. 调用 `using-git-worktrees` 技能。
2. 创建功能分支和隔离 worktree，例如 `feature/mpdb-schema-v3`。
3. 确认原工作区只保留用户的 `MPDB/` 未跟踪数据，不复制或提交该目录。
4. 记录样本目录绝对路径，供最终本地验收脚本读取。
5. 在 worktree 中运行基线命令并保存结果：

```bash
npm run build
npm run lint
node test_channel_sim.mjs
```

预期：build 通过但有警告；lint 失败；旧 GEO FSPL 断言失败。基线失败只记录，不修改断言迎合错误实现。

---

### Task 1：建立可执行测试、lint 和 CI 基线

**文件：**

- 修改：`package.json`
- 修改：`package-lock.json`
- 修改：`eslint.config.js`
- 修改：`.github/workflows/deploy.yml`
- 新建：`vitest.config.js`
- 新建：`tests/smoke/module-imports.test.js`

**Step 1：写失败的测试入口检查**

在 `tests/smoke/module-imports.test.js` 中导入 `model.js`、`oracleCore.js` 和两个 adapter，并断言核心导出存在：

```js
import { describe, expect, it } from 'vitest';
import { computeCIR } from '../../src/model.js';
import { predictLinkStateNow } from '../../src/oracleCore.js';

describe('module smoke imports', () => {
  it('exposes the supported public entry points', () => {
    expect(computeCIR).toBeTypeOf('function');
    expect(predictLinkStateNow).toBeTypeOf('function');
  });
});
```

**Step 2：验证 RED**

运行：`npm test`

预期：失败，当前没有 `test` script/Vitest。

**Step 3：安装最小依赖并配置脚本**

运行：

```bash
npm install proj4
npm install --save-dev vitest concurrently
```

增加脚本：

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "verify": "npm run test && npm run lint && npm run build"
}
```

`vitest.config.js` 使用 Node 环境、`tests/**/*.test.js`；ESLint 忽略 `dist/`、`docs/assets/`，并分别配置 browser、node/test globals，但不得忽略 `src/` 或 `server/`。

CI 使用 `npm ci`，顺序执行 test、lint、build 后再部署。

**Step 4：验证 GREEN**

运行：`npm test -- --run tests/smoke/module-imports.test.js`

预期：通过。

**Step 5：提交**

```bash
git add package.json package-lock.json eslint.config.js vitest.config.js .github/workflows/deploy.yml tests/smoke/module-imports.test.js
git commit -m "test: establish repository verification baseline"
```

---

### Task 2：定义 UnifiedScenario v3、单位和结构化诊断

**文件：**

- 新建：`src/domain/schemaVersion.js`
- 新建：`src/domain/validation.js`
- 新建：`src/domain/scenario.js`
- 新建：`src/domain/channelFrame.js`
- 新建：`tests/domain/scenario.test.js`
- 新建：`tests/domain/channelFrame.test.js`

**Step 1：写失败测试**

覆盖：

- 无单位的 `freq`、`power`、`alt` 被拒绝。
- `frequency_Hz=0`、`sampleInterval_s=0` 被范围校验拒绝，而不是被默认值替换。
- `groundSelection=null` 是合法导入状态，但 `assertScenarioReadyForComparison()` 必须拒绝。
- `selectedFrameId=0` 是合法用户选择，证明零值不会被 `||` 覆盖。
- ChannelFrame 必须包含 `frameId`、UTC 时间、几何匹配状态、CIR/PDP 和 provenance。

示例：

```js
expect(() => assertScenarioReadyForComparison({
  ...scenario,
  groundSelection: null
})).toThrow(/ground frame/i);

expect(normalizeGroundSelection({ selectedFrameId: 0 }).selectedFrameId).toBe(0);
```

**Step 2：验证 RED**

运行：`npm test -- --run tests/domain`

预期：模块不存在。

**Step 3：最小实现**

- `SCENARIO_SCHEMA_VERSION = 'satellite-channel-sim/scenario-v3'`。
- 提供 `ValidationIssue { code, severity, path, message, source }`。
- 用 `??` 和显式 validator 处理默认值。
- `createScenarioDraft()` 只创建合法空壳，不伪造物理值。
- `assertScenarioReadyForComparison()` 检查 ground selection、载频、带宽、帧数和链路实体。
- `createChannelFrame()` 校验单位字段和 frame ID。

**Step 4：验证 GREEN 与回归**

运行：

```bash
npm test -- --run tests/domain
npm run lint -- --quiet
```

**Step 5：提交**

```bash
git add src/domain tests/domain
git commit -m "feat: define scenario v3 and channel frame contracts"
```

---

### Task 3：按内容识别 Lauraycs 配置并归一化链路参数

**文件：**

- 新建：`src/importers/mpdb/configClassifier.js`
- 新建：`src/importers/mpdb/lauraycsConfigAdapter.js`
- 新建：`tests/importers/configClassifier.test.js`
- 新建：`tests/importers/lauraycsConfigAdapter.test.js`
- 新建：`tests/fixtures/lauraycsConfigs.js`

**Step 1：写失败测试**

用内联最小 JSON fixture 验证：

- 文件名任意变化不影响 `nodeGroup=baseStation/terminal` 识别。
- `type` 或 `version` 不支持时结构化拒绝。
- 发射端 `47641`、接收端 `terminal-route-1785827004804`、下行方向被正确提取。
- 时间窗生成 179 个 1 秒时间戳。
- 功率 23 归一化为 `txPower_dBm=23`，同时产生 `INFERRED_POWER_UNIT` assumption。
- 天线增益、极化、波束宽度和旋转矩阵进入明确单位字段。
- 100 MHz 带宽转换为 100,000,000 Hz。
- 原始 25/2.5/2.6 GHz 候选值保留在 provenance，不提前覆盖 MPDB 频率。

**Step 2：验证 RED**

运行：`npm test -- --run tests/importers/configClassifier.test.js tests/importers/lauraycsConfigAdapter.test.js`

**Step 3：实现分类和适配**

- 只使用 JSON 内容分类。
- 对字符串数字进行有限、显式转换。
- 检查两个配置的 simulation window、sample interval、simulation type 是否一致。
- 轨迹以 `satelliteId` 与发射端实体连接。
- 不读取或比较文件名。

**Step 4：验证 GREEN**

运行相同测试命令并执行 `npm run lint -- --quiet`。

**Step 5：提交**

```bash
git add src/importers/mpdb tests/importers tests/fixtures/lauraycsConfigs.js
git commit -m "feat: normalize Lauraycs node configurations by content"
```

---

### Task 4：实现安全 Pickle Protocol 2 子集

**文件：**

- 新建：`src/importers/mpdb/pickleOpcodes.js`
- 新建：`src/importers/mpdb/safePickleReader.js`
- 新建：`tests/helpers/buildPickleFixture.js`
- 新建：`tests/importers/safePickleReader.test.js`

**Step 1：写安全失败测试**

程序生成最小 pickle byte arrays，覆盖：

- dict/list/tuple、整数、浮点、字符串、memo、BUILD、REDUCE 和 persistent ID 的允许路径。
- 允许的 GLOBAL 只返回描述 token，不调用构造函数。
- `os.system` 等未知 GLOBAL 被拒绝。
- 未知 opcode、堆栈下溢、非法 memo、递归/对象数超限、尾随数据被拒绝。
- 错误包含 byte offset 和稳定 error code。

示例断言：

```js
expect(() => readSafePickle(maliciousGlobal)).toThrowError(
  expect.objectContaining({ code: 'PICKLE_GLOBAL_NOT_ALLOWED' })
);
```

**Step 2：验证 RED**

运行：`npm test -- --run tests/importers/safePickleReader.test.js`

**Step 3：实现白名单 VM**

- 不使用 `eval`、`Function`、动态 import 或通用反序列化库。
- GLOBAL 仅允许设计文档列出的 Table、Column、PyTorch rebuild/storage 和 OrderedDict。
- REDUCE 只组合内部 descriptor。
- 支持 limits：最大 opcode、memo、容器长度、字符串长度和嵌套深度。

**Step 4：验证 GREEN**

运行测试，并用 `rg -n "eval|new Function|import\(" src/importers/mpdb` 审核危险入口。

**Step 5：提交**

```bash
git add src/importers/mpdb/pickleOpcodes.js src/importers/mpdb/safePickleReader.js tests/helpers/buildPickleFixture.js tests/importers/safePickleReader.test.js
git commit -m "feat: add allowlisted pickle protocol reader"
```

---

### Task 5：解析 PyTorch ZIP、Storage 和 MPDB 列

**文件：**

- 新建：`src/importers/mpdb/torchArchiveReader.js`
- 新建：`src/importers/mpdb/mpdbColumnReader.js`
- 新建：`src/importers/mpdb/mpdbLimits.js`
- 新建：`tests/helpers/buildMpdbFixture.js`
- 新建：`tests/importers/torchArchiveReader.test.js`
- 新建：`tests/importers/mpdbColumnReader.test.js`

**Step 1：写失败测试**

合成小型 `.pt` ZIP：2 帧、3 条射线，包含 Long/Float/ComplexFloat Storage。验证：

- byteorder、dtype、shape、stride 和 storage key 正确解释。
- complex float 拆成 `hReal/hImag`。
- `frameOffsets` 由 `LINK_ID` 构建。
- 必需列缺失、storage 长度不符、shape 越界、重复 frame、非单调 link ID 被拒绝。
- ZIP entry 数、总解压大小、单 entry 大小和射线数量 limits 生效。
- `INNER_POSITION/INTERACTION_TYPE` 使用 ragged offsets，不生成几十万对象。

**Step 2：验证 RED**

运行：`npm test -- --run tests/importers/torchArchiveReader.test.js tests/importers/mpdbColumnReader.test.js`

**Step 3：实现 TypedArray 解析**

- JSZip 只负责 ZIP 容器；Storage 使用 ArrayBuffer/DataView/TypedArray。
- 根据 archive byteorder 显式处理 endian。
- 所有视图先验证 byteLength 与元素数量。
- 输出设计批准的列式 `rayTracing`。

**Step 4：验证 GREEN 和内存形态**

运行测试；断言 fixture 输出字段都是 TypedArray，且没有每射线 object array。

**Step 5：提交**

```bash
git add src/importers/mpdb tests/helpers/buildMpdbFixture.js tests/importers/torchArchiveReader.test.js tests/importers/mpdbColumnReader.test.js
git commit -m "feat: decode PyTorch storage into MPDB column arrays"
```

---

### Task 6：装配场景、实体关联、坐标拟合与频率冲突

**文件：**

- 新建：`src/importers/mpdb/fileContentDetector.js`
- 新建：`src/importers/mpdb/coordinateAlignment.js`
- 新建：`src/importers/mpdb/scenarioAssembler.js`
- 新建：`src/importers/mpdb/importMpdbBundle.js`
- 新建：`tests/importers/scenarioAssembler.test.js`
- 新建：`tests/importers/importMpdbBundle.test.js`
- 新建：`scripts/verify-mpdb-sample.mjs`

**Step 1：写失败测试**

覆盖：

- 三个输入被任意重命名仍按内容导入。
- transmitter/receiver ID 不匹配时失败，不能按帧数兜底。
- `FRAME_ID` 与 1 秒时间轴连接。
- 卫星局部坐标到 EPSG:32649 的平移使用各帧差值中位数求解，并报告 RMS/max residual。
- 载频优先级：MPDB 24.95 GHz 覆盖配置候选；25 GHz warning；2.5/2.6 GHz conflict warning。
- MPDB 缺频率且配置冲突时失败。
- `groundSelection` 初始为 null。
- 任意 RX frame 经 local → projected → WGS84 转换后可供用户选择。

**Step 2：验证 RED**

运行：`npm test -- --run tests/importers/scenarioAssembler.test.js tests/importers/importMpdbBundle.test.js`

**Step 3：实现场景装配**

- 用 SHA-256 内容摘要生成 scenario ID 和 file provenance。
- 使用 proj4 执行 EPSG:32649 ↔ EPSG:4326。
- 坐标残差超过配置容差时结构化拒绝。
- 保留 raw channel type，不添加未经验证的语义标签。

**Step 4：实现样本验收脚本**

脚本接受三个显式路径，打印并断言：

```text
frameCount = 179
rayCount = 465512
frequency_Hz = 24950000000
coordinateRmsResidual_m < 0.05
```

脚本不得直接 `torch.load`，必须调用生产解析器。

**Step 5：验证 GREEN**

运行自动测试；在原工作区样本可用时运行验收脚本。

**Step 6：提交**

```bash
git add src/importers/mpdb tests/importers scripts/verify-mpdb-sample.mjs
git commit -m "feat: assemble validated scenario v3 from MPDB content"
```

---

### Task 7：Web Worker、导入状态机和用户地面帧选择

**文件：**

- 新建：`src/workers/mpdbImportProtocol.js`
- 新建：`src/workers/mpdbImport.worker.js`
- 新建：`src/features/mpdb-import/importState.js`
- 新建：`src/features/mpdb-import/groundSelection.js`
- 新建：`src/features/mpdb-import/MpdbImportPanel.jsx`
- 新建：`tests/workers/mpdbImportProtocol.test.js`
- 新建：`tests/features/groundSelection.test.js`
- 修改：`src/ChannelSimPanel.jsx`

**Step 1：写失败测试**

- Worker 协议只有 `idle/parsing/validating/ready/error` 合法转移。
- progress 单调且范围 0–1。
- 未选择 frame 时 `canCompare=false`。
- `selectedFrameId=0` 合法。
- 选择任意 frame 后，计算其经纬度、高度和每帧 `groundPositionMismatch_m`。
- 改变选择会增加 comparison revision，使旧结果失效。
- 系统只返回建议列表，不自动设置 `selectedFrameId`。

**Step 2：验证 RED**

运行：`npm test -- --run tests/workers tests/features/groundSelection.test.js`

**Step 3：实现 Worker 和 UI**

- `new Worker(new URL(..., import.meta.url), { type: 'module' })`。
- ArrayBuffer/TypedArray 使用 transferable，避免复制。
- 导入面板支持一次选择三个文件，展示内容角色、ID、帧/射线数、频率冲突和坐标残差。
- 地面点表格/滑杆显示 frame ID、时间、坐标、位移和精确匹配帧数。
- 用户确认后才启用比较。

**Step 4：删除旧握手 UI 与代码**

从 `ChannelSimPanel.jsx` 删除：

- `buildCirFromRays`
- `handleImportCirZip`
- `.mat`/`trajectory.csv`/manifest 导入分支
- `handshakeInfo`、`linkedTrajectorySamples` 等只服务旧握手的状态
- `mat-for-js` 和旧 import UI

保留独立轨迹导出功能。

**Step 5：验证 GREEN**

运行：

```bash
npm test -- --run tests/workers tests/features/groundSelection.test.js
npm run build
rg -n "handleImportCirZip|buildCirFromRays|handshakeInfo|mat-for-js" src
```

最后的 `rg` 应无生产引用。

**Step 6：提交**

```bash
git add src/workers src/features/mpdb-import src/ChannelSimPanel.jsx package.json package-lock.json tests/workers tests/features
git commit -m "feat: import MPDB in a worker with explicit ground selection"
```

---

### Task 8：统一统计 CIR/PDP 并修复直接物理错误

**文件：**

- 新建：`src/channel/statisticalCir.js`
- 新建：`src/channel/pdp.js`
- 新建：`src/channel/channelMetrics.js`
- 新建：`tests/channel/statisticalCir.test.js`
- 新建：`tests/channel/pdp.test.js`
- 修改：`src/model.js`
- 迁移/修改：`test_channel_sim.mjs`

**Step 1：写失败回归测试**

覆盖：

- 显式 GEO `slantRange_km=35786` 必须保留，FSPL 约 205.5 dB，不替换为 550 km LEO。
- 仅缺失斜距时才从 `satelliteAltitude_km` 推导。
- `tec_TECU=0` 不生成电离层 tap。
- `scatterPowerOffset_dB` 精确改变散射 tap 功率。
- 城市散射相对 LOS 随仰角升高而减弱。
- 每个 tap 同时具有 absolute/excess delay、复幅度和功率字段。
- 100 MHz 使用 10 ns bin；同 bin 复幅度相干求和；非相干和单独保留。
- 超额时延基准是最早路径，不是最强路径。
- RMS delay spread、mean delay 和 coherence bandwidth 使用同一 PDP 定义。

**Step 2：验证 RED**

运行：`npm test -- --run tests/channel`

**Step 3：实现领域模块并加兼容边界**

- `statisticalCir.js` 使用明确 `_GHz/_km/_dB` 或 v3 `_Hz/_m` 入口，内部只选一种单位。
- `model.computeCIR()` 暂作为旧 UI adapter 调用新实现，避免一次性破坏无关 UI。
- 使用 `??`，不使用 falsy 默认。
- 移除 `mathjs` import；若全仓无使用，从 package 删除。

**Step 4：验证 GREEN**

运行：

```bash
npm test -- --run tests/channel
node test_channel_sim.mjs
```

将旧脚本中的关键断言迁入 Vitest 后，可删除无断言/自报 100% 的 accuracy 脚本，或改为调用真实测试，不允许继续作为“通过证据”。

**Step 5：提交**

```bash
git add src/channel src/model.js tests/channel test_channel_sim.mjs package.json package-lock.json
git commit -m "fix: unify CIR and PDP physics"
```

---

### Task 9：统一几何、地球自转多普勒、可见性和 TLE 策略

**文件：**

- 新建：`src/geometry/eciEcf.js`
- 新建：`src/geometry/linkGeometry.js`
- 新建：`src/geometry/scenarioGeometry.js`
- 新建：`src/orbit/tle.js`
- 新建：`tests/geometry/eciEcf.test.js`
- 新建：`tests/geometry/linkGeometry.test.js`
- 新建：`tests/orbit/tle.test.js`
- 修改：`src/model.js`
- 修改：`src/oracleCore.js`
- 修改：`src/knownSatellites.js`
- 修改：`server/index.js`

**Step 1：写失败回归测试**

- ECI 速度转 ECEF 使用 `v_ecef = R v_eci - ω × r_ecef`。
- 30 GHz 样例多普勒与 ECEF 位置有限差分结果在设定容差内。
- MPDB 场景几何直接使用配置轨迹和用户静态点，不调用 SGP4。
- `elevation_deg <= 0` 时 `predictLinkStateNow()` 返回 null/no contact。
- ground altitude 统一为米，传给 satellite.js 时只转换一次为 km。
- TLE epoch 解析和 age warning 可测试；无新鲜 TLE 时不伪装为实时准确。
- 前后端引用同一个卫星 registry，不再内置两套不同的过期 TLE。

**Step 2：验证 RED**

运行：`npm test -- --run tests/geometry tests/orbit`

**Step 3：实现共享几何**

- 所有 Doppler 调用集中到 `eciEcf.js`。
- `scenarioGeometry.js` 从场景 frame 生成 slant/elevation/azimuth。
- Oracle 在格式化前过滤不可见帧。
- server 导入共享 registry；默认 TLE 标注 epoch，UI/API 输出 age diagnostics。

**Step 4：验证 GREEN**

运行几何测试、`test_sgp4.mjs` 和 smoke test。

**Step 5：提交**

```bash
git add src/geometry src/orbit src/model.js src/oracleCore.js src/knownSatellites.js server/index.js tests/geometry tests/orbit
git commit -m "fix: correct orbit geometry visibility and Doppler"
```

---

### Task 10：构建确定性 RT/统计比较引擎

**文件：**

- 新建：`src/comparison/deterministicRng.js`
- 新建：`src/comparison/rtChannelAdapter.js`
- 新建：`src/comparison/statisticalEnsemble.js`
- 新建：`src/comparison/frameAlignment.js`
- 新建：`src/comparison/comparisonMetrics.js`
- 新建：`src/comparison/compareScenario.js`
- 新建：`src/features/channel-comparison/ChannelComparisonPanel.jsx`
- 新建：`tests/comparison/*.test.js`
- 修改：`src/ChannelSimPanel.jsx`
- 修改：`src/oracleCore.js`

**Step 1：写失败测试**

- seed 由 scenario/frame/realization 生成，相同输入 byte-for-byte 相同。
- 默认每帧 32 realization，输出 median/P5/P95。
- RT 绝对功率为 `{ status: 'unavailable', reason: 'UNDEFINED_H_NORMALIZATION' }`。
- 不存在 `23 + 10log10(sumH2)` 的伪造路径。
- 用户选定地面点后，按 mismatch tolerance 分类 exact/approximate。
- 默认汇总只包含 exact 帧；近似帧仍可查询。
- PDP JS divergence、加权 delay distance、RMS delay spread 和角度/多普勒统计在手算 fixture 上正确。
- 未映射的 channel type 仍输出 raw code，不生成 LOS 文案。

**Step 2：验证 RED**

运行：`npm test -- --run tests/comparison`

**Step 3：实现比较管线**

- RT adapter 按 frameOffsets 切片，不复制全量射线。
- 统计 ensemble 可取消并报告进度。
- 比较报告携带 scenario ID、ground selection、模型版本、seed、provenance 和 diagnostics。
- Oracle 的旧 closest-time RT SNR confidence 改为消费 comparison report，不再假设 RT 有绝对 SNR。

**Step 4：接入 UI**

- PDP overlay：RT 曲线、统计 median、P5–P95。
- 展示 exact/approximate 数量、当前帧 geometry mismatch、指标表和警告。
- 禁止在 ground selection 为空时运行。

**Step 5：验证 GREEN**

运行比较测试、build，并对合成 fixture 做 UI 数据 smoke test。

**Step 6：提交**

```bash
git add src/comparison src/features/channel-comparison src/ChannelSimPanel.jsx src/oracleCore.js tests/comparison
git commit -m "feat: compare RT and statistical channel frames reproducibly"
```

---

### Task 11：修复地面校准的数据定义、可辨识性和 UI

**文件：**

- 新建：`src/calibration/schema.js`
- 新建：`src/calibration/measurementAdapter.js`
- 新建：`src/calibration/calibrationEngine.js`
- 新建：`src/calibration/storage.js`
- 新建：`tests/calibration/*.test.js`
- 修改：`src/model.js`
- 修改：`src/ChannelSimPanel.jsx`
- 修改：`src/UserManual.jsx`
- 迁移/修改：`test_calibration.js`

**Step 1：写失败测试**

- C/N0 使用 dB-Hz；带宽积分后的量命名为 C/N 或 SNR，不再叫 C/N0。
- 每个测量点可带 timestamp/frameId/slantRange；LEO 校准不回退 GEO 35786 km。
- scatter offset 改变模拟 residual。
- 零 offset、零 TEC 和零 rain rate 被保留。
- 参考卫星只覆盖明确提供的字段，并包括 bandwidth/receiver 参数的来源诊断。
- 位置差异在更新当前 ground station 前计算。
- 测量数量/类型不足以辨识参数时，参数被冻结或返回 `UNIDENTIFIABLE_PARAMETER`，不输出虚假精度。
- profile 带 schemaVersion、confidence/condition diagnostics，可序列化恢复。

**Step 2：验证 RED**

运行：`npm test -- --run tests/calibration`

**Step 3：实现引擎并修复 UI setter**

- 从 `model.js` 抽出校准逻辑，保留薄兼容导出。
- `ChannelSimPanel` 使用现有 `onLinkParamsChange` 更新 `gRx/tRx/bandwidth/tec/freq/eirp`，删除未定义 `setGRx/setTRx/setBandwidth/setTec/setFreq/setEirp`。
- 校准 profile 持久化到带版本键的 localStorage，并验证导入。

**Step 4：验证 GREEN**

运行校准测试、lint、build。

**Step 5：提交**

```bash
git add src/calibration src/model.js src/ChannelSimPanel.jsx src/UserManual.jsx tests/calibration test_calibration.js
git commit -m "fix: make ground calibration identifiable and unit correct"
```

---

### Task 12：修正 NTN/DVB 语义、outage 和 API 输入边界

**文件：**

- 修改：`src/adapters/ntnAdapter.js`
- 修改：`src/adapters/dvbS2xAdapter.js`
- 修改：`src/oracleCore.js`
- 新建：`server/inputValidation.js`
- 修改：`server/index.js`
- 修改：`src/panels/ApiDashboard.jsx`
- 新建：`tests/adapters/ntnAdapter.test.js`
- 新建：`tests/adapters/dvbS2xAdapter.test.js`
- 新建：`tests/server/inputValidation.test.js`

**Step 1：写失败测试**

- SNR 不得被当作 path loss。
- 未提供路径损耗时输出 unavailable，而不是负 SNR。
- heuristic 输出包含 `modelStatus: 'heuristic-not-standard-compliant'`。
- 低于最低 MODCOD 门限时返回 outage/null efficiency，不返回 QPSK 1/4。
- SNR 和 Es/N0 字段不可互换。
- 空 `modcodTimeline` UI helper 返回空状态，不 reduce 崩溃。
- 纬经度、高度、hours、TLE 和 link params 的 NaN/Infinity/越界输入返回 400。
- `HOST` 默认 `127.0.0.1`；只有显式配置才监听 `0.0.0.0`。
- WS 请求窗口和发送频率有限制。

**Step 2：验证 RED**

运行：`npm test -- --run tests/adapters tests/server`

**Step 3：实现最小修复**

- 删除硬编码 `60 + 42` 和 pathLoss/SNR 伪映射。
- MODCOD selection 显式返回 outage object。
- 提取纯函数 `parseGroundStation/parseHours/validateTle/validateLinkParams`。
- ApiDashboard 在空 timeline 显示“无可用 MODCOD 样本”。

**Step 4：验证 GREEN**

运行适配器/server 测试、build，并启动 API 做 health smoke test。

**Step 5：提交**

```bash
git add src/adapters src/oracleCore.js server src/panels/ApiDashboard.jsx tests/adapters tests/server
git commit -m "fix: enforce adapter and API semantics"
```

---

### Task 13：修复 Historical Replay、真实/合成数据标记和有界状态

**文件：**

- 新建：`src/replay/replaySchema.js`
- 新建：`src/replay/boundedSeries.js`
- 新建：`src/features/replay/useChannelReplay.js`
- 新建：`tests/replay/*.test.js`
- 修改：`src/App.jsx`
- 修改：`src/UserManual.jsx`

**Step 1：写失败测试**

- replay JSON 解析为 ChannelFrame-compatible 数据，非法 timestamp/metric 被拒绝。
- bounded series 超出上限后丢弃最旧项。
- Open-Meteo 只提供降水率时，生成的数据标记 `source='synthetic-derived'`，不叫 measurement。
- `Math.random()` 噪声被 seeded generator 取代或明确不作为测量保存。
- replayData 可实际加载，不再永远是只读空数组。
- replay start/stop/unmount 清理 timer，不重复发送。

**Step 2：验证 RED**

运行：`npm test -- --run tests/replay`

**Step 3：实现并从 App 拆出 hook**

- `useChannelReplay` 管理文件加载、index、timer 和状态。
- live series 默认上限明确，例如 3,600 帧。
- UI 分开显示“观测输入”和“模型派生损耗”。

**Step 4：验证 GREEN**

运行 replay 测试、lint、build。

**Step 5：提交**

```bash
git add src/replay src/features/replay src/App.jsx src/UserManual.jsx tests/replay
git commit -m "fix: make historical replay bounded and provenance aware"
```

---

### Task 14：完成结构拆分、按需加载、文档和全量验收

**文件：**

- 修改：`src/App.jsx`
- 修改：`src/ChannelSimPanel.jsx`
- 修改：`src/model.js`
- 修改：`src/UserManual.jsx`
- 修改：`README.md`
- 修改：`Validation_Guide.md`
- 修改：`vite.config.js`
- 修改：`.gitignore`
- 删除或迁移：无断言的根目录测试/调试脚本
- 修改：所有仍有 lint/build warning 的源码文件

**Step 1：先运行失败清单**

```bash
npm run test
npm run lint
npm run build
```

把每个剩余失败写成测试或明确的静态修复项，不用禁用规则掩盖源码问题。

**Step 2：完成结构和性能重构**

- App 只负责顶层路由/状态组合，回放和导出逻辑进入 feature modules。
- ChannelSimPanel 只组合导入、选择、比较和校准子面板。
- model.js 保留兼容 facade，物理实现来自 `channel/geometry/calibration`。
- MPDB importer/worker 通过动态 import 按需加载。
- 删除 `mathjs` 和 `mat-for-js` 依赖（确认无引用后）。
- 修复 UserManual 重复 style、satellite.js import warning 和 hook/lint 错误。
- `full` script 使用已安装 concurrently 正常启动。

**Step 3：更新文档**

README 和用户手册必须说明：

- 三文件 MPDB 导入，但文件名不参与识别。
- 实体 ID、frame ID 和坐标残差校验。
- 用户必须选择静态地面帧。
- PDP 最早路径基准、10 ns 分箱和相干聚合。
- RT 绝对功率 unavailable 的原因。
- 旧 `.mat/trajectory.csv/frame_*.mat` 比较导入已移除。
- Historical Replay 与校准的来源/单位定义。

**Step 4：运行用户样本验收**

从 worktree 调用 `scripts/verify-mpdb-sample.mjs`，传入原工作区三个文件的显式绝对路径。确认输出：

- 179 帧。
- 465,512 射线。
- 24.95 GHz。
- 坐标 RMS < 0.05 m。
- 任意重命名的临时副本仍能按内容导入。
- 错配配置 fixture 被拒绝。

**Step 5：全量验证**

```bash
npm run verify
npm run full
```

`npm run full` 只做短时启动 smoke test，确认 Vite 和 API 都启动后正常终止，不把长期进程留在后台。

另外执行：

```bash
rg -n "handleImportCirZip|buildCirFromRays|frame_.*mat|trajectory.csv.*handshake|pathLoss_dB:.*snr|measuredCN0_dB.*noiseFloor" src README.md Validation_Guide.md
```

所有命中必须逐项解释或移除。

**Step 6：最终提交**

```bash
git add src server tests scripts README.md Validation_Guide.md package.json package-lock.json vite.config.js eslint.config.js .github/workflows/deploy.yml .gitignore
git commit -m "refactor: complete scenario v3 repository migration"
```

---

## 执行批次与汇报点

按 `executing-plans` 分批执行并在每批后汇报：

1. **批次 A：Task 1–3** — 测试基线、Schema、配置适配。
2. **批次 B：Task 4–6** — 安全 Pickle、Storage、场景装配和用户样本验收脚本。
3. **批次 C：Task 7–10** — Worker/UI、统一 PDP、几何修复、比较引擎。
4. **批次 D：Task 11–13** — 校准、adapter/API、Historical Replay。
5. **批次 E：Task 14** — 结构、文档和全量验证。

每个汇报点必须包含：

- 已完成任务与 commit。
- 新增/修改的测试和最新命令输出。
- 与设计的偏差及原因。
- 尚存风险和下一批内容。

任何任务如发现设计假设错误，停止该任务并先更新设计/计划，不以临时兼容逻辑绕过。
