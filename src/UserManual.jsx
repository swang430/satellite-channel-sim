import React from 'react';

/**
 * 卫星信道仿真系统 — 使用手册
 * 以浮层页面形式展示完整的功能指南
 */
export default function UserManual({ onClose }) {
    const sectionStyle = {
        marginBottom: '24px',
        padding: '16px 20px',
        background: 'rgba(255,255,255,0.03)',
        borderRadius: '8px',
        border: '1px solid rgba(255,255,255,0.08)',
        textAlign: 'left'
    };
    const h2Style = { fontSize: '1.2em', color: '#4ecdc4', margin: '0 0 12px 0', borderBottom: '1px solid rgba(78,205,196,0.3)', paddingBottom: '8px' };
    const h3Style = { fontSize: '1em', color: '#f39c12', margin: '16px 0 8px 0' };
    const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: '0.85em', marginTop: '8px' };
    const thStyle = { padding: '6px 10px', background: 'rgba(78,205,196,0.15)', borderBottom: '2px solid rgba(78,205,196,0.3)', textAlign: 'left', color: '#4ecdc4', fontWeight: 'bold' };
    const tdStyle = { padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#ccc' };
    const codeStyle = { background: 'rgba(78,205,196,0.1)', padding: '1px 5px', borderRadius: '3px', fontFamily: 'monospace', fontSize: '0.9em', color: '#4ecdc4' };
    const tipStyle = { padding: '10px 14px', background: 'rgba(46,204,113,0.08)', border: '1px solid rgba(46,204,113,0.3)', borderRadius: '5px', fontSize: '0.85em', color: '#a0d8b0', marginTop: '10px' };
    const warnStyle = { ...tipStyle, background: 'rgba(243,156,18,0.08)', border: '1px solid rgba(243,156,18,0.3)', color: '#f5d49a' };
    const dangerStyle = { ...tipStyle, background: 'rgba(231,76,60,0.08)', border: '1px solid rgba(231,76,60,0.3)', color: '#f5a0a0' };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.85)', zIndex: 10000,
            display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
            overflow: 'auto', padding: '40px 20px'
        }}>
            <div style={{
                maxWidth: '900px', width: '100%',
                background: 'linear-gradient(135deg, #0f0f1a, #1a1a2e)',
                borderRadius: '12px', border: '1px solid rgba(78,205,196,0.3)',
                padding: '30px 36px', position: 'relative',
                boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
                color: '#ddd', lineHeight: '1.7'
            }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
                    <div>
                        <h1 style={{ fontSize: '1.5em', color: '#fff', margin: '0 0 4px 0' }}>
                            📖 卫星信道仿真系统 — 使用手册
                        </h1>
                        <div style={{ fontSize: '0.85em', color: '#888' }}>Satellite Channel Propagation Simulator v2.0</div>
                    </div>
                    <button onClick={onClose} style={{
                        background: 'rgba(255,100,100,0.15)', border: '1px solid rgba(255,100,100,0.4)',
                        color: '#ff6b6b', fontSize: '1em', padding: '6px 14px', borderRadius: '5px',
                        cursor: 'pointer', fontWeight: 'bold', marginLeft: '20px', flexShrink: 0
                    }}>✕ 关闭</button>
                </div>

                {/* 目录 */}
                <div style={sectionStyle}>
                    <h2 style={h2Style}>📋 目录</h2>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 20px', fontSize: '0.9em' }}>
                        {[
                            ['1', '系统概述'],
                            ['2', '轨道配置 (SGP4)'],
                            ['3', '链路预算与静态仿真'],
                            ['4', '信道传播仿真面板'],
                            ['5', '地面测量校准系统'],
                            ['6', '天气数据与实时同步'],
                            ['7', '数据导出'],
                            ['8', '校准数据格式规范']
                        ].map(([n, title]) => (
                            <div key={n} style={{ color: '#aaa' }}>
                                <span style={{ color: '#4ecdc4', fontWeight: 'bold' }}>{n}.</span> {title}
                            </div>
                        ))}
                    </div>
                </div>

                {/* 1. 系统概述 */}
                <div style={sectionStyle}>
                    <h2 style={h2Style}>1. 系统概述</h2>
                    <p>本系统是一个基于 Web 的卫星通信信道仿真器，支持从 UHF 到 Ka 频段的端到端链路预算计算、
                        动态轨道跟踪（SGP4）、信道脉冲响应（CIR）建模、以及地面测量数据校准。</p>

                    <h3 style={h3Style}>核心功能</h3>
                    <table style={tableStyle}>
                        <thead><tr>
                            <th style={thStyle}>模块</th>
                            <th style={thStyle}>功能</th>
                        </tr></thead>
                        <tbody>
                            <tr><td style={tdStyle}>🛰️ 轨道配置</td><td style={tdStyle}>SGP4 实时轨道计算、TLE 输入、地面站配置</td></tr>
                            <tr><td style={tdStyle}>📊 链路预算</td><td style={tdStyle}>大气衰减（雨衰/气体/云雾）、Faraday 旋转、XPD</td></tr>
                            <tr><td style={tdStyle}>📡 信道仿真</td><td style={tdStyle}>时间序列生成、CIR 多径建模、快衰落（闪烁）</td></tr>
                            <tr><td style={tdStyle}>🎯 地面校准</td><td style={tdStyle}>多参数 Gauss-Newton 优化、已知卫星参考库</td></tr>
                            <tr><td style={tdStyle}>🌦️ 天气同步</td><td style={tdStyle}>Open-Meteo API 实时/JSON 回放</td></tr>
                        </tbody>
                    </table>
                </div>

                {/* 2. 轨道配置 */}
                <div style={sectionStyle}>
                    <h2 style={h2Style}>2. 轨道配置 (SGP4)</h2>
                    <p>启用 <span style={codeStyle}>Enable Real-time Orbit Tracking</span> 后，系统使用 SGP4 算法
                        根据 TLE（Two-Line Element）数据实时计算卫星位置。</p>

                    <h3 style={h3Style}>TLE 输入</h3>
                    <p>在 <span style={codeStyle}>TLE Line 1</span> 和 <span style={codeStyle}>TLE Line 2</span> 中
                        输入目标卫星的 TLE 数据。可从 <a href="https://celestrak.org" target="_blank" rel="noreferrer"
                            style={{ color: '#4ecdc4' }}>CelesTrak</a> 或 <a href="https://space-track.org" target="_blank"
                                rel="noreferrer" style={{ color: '#4ecdc4' }}>Space-Track</a> 获取。</p>

                    <h3 style={h3Style}>地面站</h3>
                    <table style={tableStyle}>
                        <thead><tr>
                            <th style={thStyle}>参数</th><th style={thStyle}>说明</th><th style={thStyle}>默认值</th>
                        </tr></thead>
                        <tbody>
                            <tr><td style={tdStyle}>GS Lat</td><td style={tdStyle}>地面站纬度 (°N)</td><td style={tdStyle}>22.54 (深圳)</td></tr>
                            <tr><td style={tdStyle}>GS Lon</td><td style={tdStyle}>地面站经度 (°E)</td><td style={tdStyle}>114.05</td></tr>
                            <tr><td style={tdStyle}>GS Alt</td><td style={tdStyle}>地面站海拔 (km)</td><td style={tdStyle}>0.0</td></tr>
                        </tbody>
                    </table>
                </div>

                {/* 3. 链路预算 */}
                <div style={sectionStyle}>
                    <h2 style={h2Style}>3. 链路预算与静态仿真</h2>
                    <p>主面板提供实时链路预算计算，根据仰角和降雨率动态更新以下指标：</p>

                    <table style={tableStyle}>
                        <thead><tr>
                            <th style={thStyle}>指标</th><th style={thStyle}>说明</th><th style={thStyle}>单位</th>
                        </tr></thead>
                        <tbody>
                            <tr><td style={tdStyle}>Free Space Loss</td><td style={tdStyle}>自由空间路径损耗</td><td style={tdStyle}>dB</td></tr>
                            <tr><td style={tdStyle}>Rain Attenuation</td><td style={tdStyle}>雨衰（ITU-R P.838 模型）</td><td style={tdStyle}>dB</td></tr>
                            <tr><td style={tdStyle}>Gas Attenuation</td><td style={tdStyle}>氧气 + 水蒸气吸收</td><td style={tdStyle}>dB</td></tr>
                            <tr><td style={tdStyle}>C/N</td><td style={tdStyle}>载噪比</td><td style={tdStyle}>dB</td></tr>
                            <tr><td style={tdStyle}>XPD</td><td style={tdStyle}>交叉极化鉴别度</td><td style={tdStyle}>dB</td></tr>
                            <tr><td style={tdStyle}>Faraday Rotation</td><td style={tdStyle}>电离层法拉第旋转角</td><td style={tdStyle}>deg</td></tr>
                        </tbody>
                    </table>

                    <h3 style={h3Style}>关键参数</h3>
                    <table style={tableStyle}>
                        <thead><tr>
                            <th style={thStyle}>参数</th><th style={thStyle}>说明</th><th style={thStyle}>典型范围</th>
                        </tr></thead>
                        <tbody>
                            <tr><td style={tdStyle}>Freq (GHz)</td><td style={tdStyle}>工作频率</td><td style={tdStyle}>0.3 ~ 30</td></tr>
                            <tr><td style={tdStyle}>EIRP (dBW)</td><td style={tdStyle}>等效全向辐射功率</td><td style={tdStyle}>20 ~ 60</td></tr>
                            <tr><td style={tdStyle}>G/T (dB/K)</td><td style={tdStyle}>接收品质因数</td><td style={tdStyle}>10 ~ 45</td></tr>
                            <tr><td style={tdStyle}>Rain Rate (mm/h)</td><td style={tdStyle}>降雨率</td><td style={tdStyle}>0 ~ 100</td></tr>
                            <tr><td style={tdStyle}>TEC</td><td style={tdStyle}>总电子含量 (TECU)</td><td style={tdStyle}>10 ~ 100</td></tr>
                        </tbody>
                    </table>
                </div>

                {/* 4. 信道传播仿真面板 */}
                <div style={sectionStyle}>
                    <h2 style={h2Style}>4. 信道传播仿真面板 (Channel Propagation Simulator)</h2>
                    <p>基于 SGP4 轨道预测，在卫星过境期间生成完整的信道传播时间序列。</p>

                    <h3 style={h3Style}>使用流程</h3>
                    <ol style={{ paddingLeft: '20px', fontSize: '0.9em' }}>
                        <li><strong>设置地面站坐标和链路参数</strong>（频率、EIRP、增益等）</li>
                        <li>点击 <span style={codeStyle}>🔍 Search Passes</span> 搜索可用过境</li>
                        <li>从列表中选择一个 Pass 时段</li>
                        <li>点击 <span style={codeStyle}>🚀 Generate Channel TimeSeries</span> 生成</li>
                        <li>查看图表：Total Loss、C/N0、Elevation、CIR 等</li>
                    </ol>

                    <h3 style={h3Style}>CIR（信道脉冲响应）</h3>
                    <p>CIR 建模基于环境类型（rural / suburban / urban），包含直射径和多径散射分量：</p>
                    <table style={tableStyle}>
                        <thead><tr>
                            <th style={thStyle}>环境</th><th style={thStyle}>Tap 数</th><th style={thStyle}>说明</th>
                        </tr></thead>
                        <tbody>
                            <tr><td style={tdStyle}>Rural</td><td style={tdStyle}>2</td><td style={tdStyle}>直射 + 地面反射</td></tr>
                            <tr><td style={tdStyle}>Suburban</td><td style={tdStyle}>4</td><td style={tdStyle}>直射 + 地面反射 + 建筑散射 × 2</td></tr>
                            <tr><td style={tdStyle}>Urban</td><td style={tdStyle}>6</td><td style={tdStyle}>直射 + 多重反射/散射</td></tr>
                        </tbody>
                    </table>

                    <h3 style={h3Style}>快衰落（闪烁）</h3>
                    <p>可通过 <span style={codeStyle}>Disable Fast Fading</span> 关闭闪烁效应，
                        适用于清洁的慢衰落分析和数据回放。</p>
                </div>

                {/* 5. 地面测量校准系统 */}
                <div style={sectionStyle}>
                    <h2 style={h2Style}>5. 地面测量校准系统 🎯</h2>
                    <p>使用地面实测数据校正仿真模型的系统偏差。校准使用 <strong>Gauss-Newton</strong> 多参数优化算法，
                        同时调整 5 个独立参数。</p>

                    <h3 style={h3Style}>校准原理</h3>
                    <p>校准的目标是修正<strong>设备偏差</strong>和<strong>环境偏差</strong>，而非卫星本身的参数：</p>
                    <table style={tableStyle}>
                        <thead><tr>
                            <th style={thStyle}>校准参数</th><th style={thStyle}>含义</th><th style={thStyle}>范围</th>
                        </tr></thead>
                        <tbody>
                            <tr><td style={tdStyle}>雨衰修正系数</td><td style={tdStyle}>ITU-R 雨衰模型在本地的偏差修正</td><td style={tdStyle}>0.3 ~ 3.0</td></tr>
                            <tr><td style={tdStyle}>气体衰减偏移</td><td style={tdStyle}>本地大气密度/湿度偏差</td><td style={tdStyle}>-2.0 ~ 2.0 dB</td></tr>
                            <tr><td style={tdStyle}>散射功率偏移</td><td style={tdStyle}>多径散射环境修正 (CIR)</td><td style={tdStyle}>-10 ~ 5 dB</td></tr>
                            <tr><td style={tdStyle}>EIRP 偏移</td><td style={tdStyle}>接收链路增益/损耗偏差</td><td style={tdStyle}>-5 ~ 5 dB</td></tr>
                            <tr><td style={tdStyle}>系统噪温偏移</td><td style={tdStyle}>接收机噪声温度偏差</td><td style={tdStyle}>-50 ~ 200 K</td></tr>
                        </tbody>
                    </table>

                    <h3 style={h3Style}>使用步骤</h3>
                    <ol style={{ paddingLeft: '20px', fontSize: '0.9em' }}>
                        <li>点击 <span style={codeStyle}>🛠️ 展开校准面板</span></li>
                        <li><strong>导入测量数据</strong>：上传 JSON 文件（格式见第 8 节）</li>
                        <li><strong>选择参考卫星</strong>：从已知卫星库选择，或通过 JSON 的 metadata 自动填充</li>
                        <li>点击 <span style={codeStyle}>🎯 运行多参数校准</span></li>
                        <li>查看校准结果（各参数值 + RMS 残差）</li>
                        <li>使用 <span style={codeStyle}>✅ 已启用校准修正 / ❌ 未启用校准</span> Toggle 切换</li>
                        <li>重新 Generate 对比校准前后效果</li>
                    </ol>

                    <h3 style={h3Style}>已知卫星参考库</h3>
                    <p>系统内置 6 颗覆盖 UHF ~ Ka 频段的参考卫星：</p>
                    <table style={tableStyle}>
                        <thead><tr>
                            <th style={thStyle}>卫星</th><th style={thStyle}>类型</th><th style={thStyle}>频段</th><th style={thStyle}>适用场景</th>
                        </tr></thead>
                        <tbody>
                            <tr><td style={tdStyle}>中国空间站 天和</td><td style={tdStyle}>LEO</td><td style={tdStyle}>S (2.2 GHz)</td><td style={tdStyle}>动态仰角校准</td></tr>
                            <tr><td style={tdStyle}>Intelsat 906</td><td style={tdStyle}>GEO</td><td style={tdStyle}>C / Ku</td><td style={tdStyle}>长时间雨衰校准</td></tr>
                            <tr><td style={tdStyle}>SES Astra 2E</td><td style={tdStyle}>GEO</td><td style={tdStyle}>Ku / Ka</td><td style={tdStyle}>Ka 衰减校准</td></tr>
                            <tr><td style={tdStyle}>MUOS-5</td><td style={tdStyle}>GEO</td><td style={tdStyle}>UHF (0.36 GHz)</td><td style={tdStyle}>电离层效应校准</td></tr>
                            <tr><td style={tdStyle}>APStar-6D</td><td style={tdStyle}>GEO</td><td style={tdStyle}>Ku / Ka</td><td style={tdStyle}>高吞吐量校准</td></tr>
                            <tr><td style={tdStyle}>北斗三号 MEO</td><td style={tdStyle}>MEO</td><td style={tdStyle}>L (1.268 GHz)</td><td style={tdStyle}>电离层延迟校准</td></tr>
                        </tbody>
                    </table>

                    <div style={warnStyle}>
                        <strong>⚠️ 校准适用范围：</strong>校准结果对<strong>同一地点</strong>有效。
                        如果校准数据来源地点与当前地面站距离 &gt;50 km，系统会显示黄色警告；
                        &gt;200 km 显示红色警告。不同气候区的大气条件差异可能使校准失效。
                    </div>

                    <h3 style={h3Style}>已知卫星 vs 自定义卫星</h3>
                    <table style={tableStyle}>
                        <thead><tr>
                            <th style={thStyle}>方式</th><th style={thStyle}>卫星参数</th><th style={thStyle}>数据校验</th>
                        </tr></thead>
                        <tbody>
                            <tr><td style={tdStyle}>已知卫星（库中选择或 JSON ID）</td><td style={tdStyle}>自动获取，参数完整</td><td style={tdStyle}>无需校验</td></tr>
                            <tr><td style={tdStyle}>自定义卫星（JSON 对象）</td><td style={tdStyle}>用户必须提供</td><td style={tdStyle}>必填: freq, eirp, polarization, bandwidth</td></tr>
                        </tbody>
                    </table>

                    <div style={dangerStyle}>
                        <strong>⛔ 自定义卫星必填字段：</strong>频率 (freq)、发射功率 (eirp)、极化 (polarization)、带宽 (bandwidth)。
                        缺少任何一个字段将<strong>阻止校准</strong>——因为方程欠定，结果无参考价值。
                    </div>
                </div>

                {/* 6. 天气数据 */}
                <div style={sectionStyle}>
                    <h2 style={h2Style}>6. 天气数据与实时同步</h2>
                    <p>位于页面下方的 <span style={codeStyle}>天气数据 & 实时同步</span> 面板提供实时和回放的降雨率数据。</p>

                    <table style={tableStyle}>
                        <thead><tr>
                            <th style={thStyle}>模式</th><th style={thStyle}>数据源</th><th style={thStyle}>用途</th>
                        </tr></thead>
                        <tbody>
                            <tr><td style={tdStyle}>Open-Meteo API</td><td style={tdStyle}>在线气象 API</td><td style={tdStyle}>实时驱动主面板雨衰可视化</td></tr>
                            <tr><td style={tdStyle}>JSON Replay</td><td style={tdStyle}>本地历史 JSON</td><td style={tdStyle}>回放特定时段的天气条件</td></tr>
                        </tbody>
                    </table>

                    <div style={tipStyle}>
                        <strong>💡 提示：</strong>天气同步面板仅影响主面板的实时图表展示。
                        信道仿真面板（ChannelSimPanel）使用自身的 Rain Rate 参数，两者独立互不影响。
                    </div>
                </div>

                {/* 7. 数据导出 */}
                <div style={sectionStyle}>
                    <h2 style={h2Style}>7. 数据导出</h2>
                    <p>信道仿真面板支持两种导出格式：</p>

                    <h3 style={h3Style}>CSV 导出</h3>
                    <p>包含每个时间步的完整链路指标和 CIR 各 tap 的详细数据：</p>
                    <div style={{ fontFamily: 'monospace', fontSize: '0.8em', background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '5px', overflowX: 'auto', color: '#aaa' }}>
                        Time, Elevation, FSPL, RainAtten, GasAtten, TotalLoss, CN0, XPD, FaradayRot,<br />
                        CIR_Tap1_Label, CIR_Tap1_ExcessDelay, CIR_Tap1_Amplitude, CIR_Tap1_Phase, ...
                    </div>

                    <h3 style={h3Style}>JSON 导出</h3>
                    <p>包含完整的仿真参数和时间序列数据，可用于后续分析或回放。</p>
                </div>

                {/* 8. 校准数据格式 */}
                <div style={sectionStyle}>
                    <h2 style={h2Style}>8. 校准数据格式规范</h2>

                    <h3 style={h3Style}>格式一：已知卫星</h3>
                    <pre style={{ background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '5px', fontSize: '0.8em', overflowX: 'auto', color: '#aaa', lineHeight: '1.5' }}>
                        {`{
  "metadata": {
    "satellite": "CSS_TIANHE",        // 已知卫星 ID
    "band": "S",                      // 频段 key
    "groundStation": {
      "lat": 22.54, "lon": 114.05, "alt": 0
    },
    "receiver": { "gRx": 42.0, "tRx": 150.0, "bandwidth": 400.0 },
    "environment": "suburban",
    "tec": 50,
    "description": "深圳站 CSS 天和过境观测"
  },
  "measurements": [
    {
      "timestamp": "2026-02-23T10:00:00Z",
      "elevation": 35.2,               // 必填: 仰角(°)
      "rainRate": 3.0,                  // 建议: 降雨率(mm/h)
      "measuredCN0_dB": 11.5,           // 测量指标(至少一个)
      "measuredRSSI_dBm": -87.2,
      "measuredXPD_dB": 27.5,
      "measuredAttenuation_dB": 3.8
    }
  ]
}`}
                    </pre>

                    <h3 style={h3Style}>格式二：自定义卫星</h3>
                    <pre style={{ background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '5px', fontSize: '0.8em', overflowX: 'auto', color: '#aaa', lineHeight: '1.5' }}>
                        {`{
  "metadata": {
    "satellite": {
      "name": "MyCustomSat",           // 卫星名称
      "freq": 10.95,                   // ⛔ 必填: 频率(GHz)
      "eirp": 36.0,                    // ⛔ 必填: EIRP(dBW)
      "polarization": "Linear-V",      // ⛔ 必填: 极化方式
      "bandwidth": 250.0,              // ⛔ 必填: 带宽(MHz)
      "modulation": "OFDM",            // 可选: 调制方式
      "type": "LEO"                    // 可选: 轨道类型
    },
    "groundStation": { "lat": 39.92, "lon": 116.39, "alt": 50 },
    "description": "北京站自定义卫星过境观测"
  },
  "measurements": [ ... ]
}`}
                    </pre>

                    <h3 style={h3Style}>格式三：纯数组（向后兼容）</h3>
                    <pre style={{ background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '5px', fontSize: '0.8em', overflowX: 'auto', color: '#aaa', lineHeight: '1.5' }}>
                        {`[
  { "elevation": 35.2, "rainRate": 3.0, "measuredCN0_dB": 11.5 },
  ...
]`}
                    </pre>
                    <div style={warnStyle}>
                        <strong>⚠️ 纯数组格式</strong>不携带卫星和地面站信息，需手动在面板中设置参数。
                        系统无法进行地理一致性校验。
                    </div>

                    <h3 style={h3Style}>测量指标说明</h3>
                    <table style={tableStyle}>
                        <thead><tr>
                            <th style={thStyle}>字段</th><th style={thStyle}>说明</th><th style={thStyle}>必填</th>
                        </tr></thead>
                        <tbody>
                            <tr><td style={tdStyle}><code>elevation</code></td><td style={tdStyle}>仰角 (°)</td><td style={tdStyle}>强烈建议</td></tr>
                            <tr><td style={tdStyle}><code>rainRate</code></td><td style={tdStyle}>降雨率 (mm/h)</td><td style={tdStyle}>建议</td></tr>
                            <tr><td style={tdStyle}><code>measuredCN0_dB</code></td><td style={tdStyle}>载噪比 (dB-Hz)</td><td style={{ ...tdStyle, color: '#4ecdc4' }}>至少一个</td></tr>
                            <tr><td style={tdStyle}><code>measuredRSSI_dBm</code></td><td style={tdStyle}>接收信号强度 (dBm)</td><td style={{ ...tdStyle, color: '#4ecdc4' }}>至少一个</td></tr>
                            <tr><td style={tdStyle}><code>measuredXPD_dB</code></td><td style={tdStyle}>交叉极化鉴别度 (dB)</td><td style={{ ...tdStyle, color: '#4ecdc4' }}>至少一个</td></tr>
                            <tr><td style={tdStyle}><code>measuredAttenuation_dB</code></td><td style={tdStyle}>总衰减 (dB)</td><td style={{ ...tdStyle, color: '#4ecdc4' }}>至少一个</td></tr>
                        </tbody>
                    </table>
                </div>

                {/* 已知卫星 ID 参考 */}
                <div style={sectionStyle}>
                    <h2 style={h2Style}>附录：已知卫星 ID 速查</h2>
                    <table style={tableStyle}>
                        <thead><tr>
                            <th style={thStyle}>JSON ID</th><th style={thStyle}>名称</th><th style={thStyle}>可用频段</th>
                        </tr></thead>
                        <tbody>
                            <tr><td style={tdStyle}><code>CSS_TIANHE</code></td><td style={tdStyle}>中国空间站 天和</td><td style={tdStyle}>S</td></tr>
                            <tr><td style={tdStyle}><code>INTELSAT_906</code></td><td style={tdStyle}>Intelsat 906</td><td style={tdStyle}>C, Ku</td></tr>
                            <tr><td style={tdStyle}><code>SES_ASTRA_2E</code></td><td style={tdStyle}>SES Astra 2E</td><td style={tdStyle}>Ku, Ka</td></tr>
                            <tr><td style={tdStyle}><code>MUOS_5</code></td><td style={tdStyle}>MUOS-5</td><td style={tdStyle}>UHF</td></tr>
                            <tr><td style={tdStyle}><code>APSTAR_6D</code></td><td style={tdStyle}>APStar-6D</td><td style={tdStyle}>Ku, Ka</td></tr>
                            <tr><td style={tdStyle}><code>BEIDOU_3_MEO</code></td><td style={tdStyle}>北斗三号 MEO</td><td style={tdStyle}>L</td></tr>
                        </tbody>
                    </table>
                </div>

                {/* Footer */}
                <div style={{ textAlign: 'center', padding: '10px', color: '#555', fontSize: '0.8em', borderTop: '1px solid rgba(255,255,255,0.05)', marginTop: '10px' }}>
                    Satellite Channel Propagation Simulator v2.0 | 校准系统升级 2026-02-23
                </div>
            </div>
        </div>
    );
}
