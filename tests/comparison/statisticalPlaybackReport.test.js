import { describe, expect, it } from 'vitest';
import { buildStatisticalPlaybackReport } from '../../src/features/channel-comparison/statisticalPlaybackReport.js';

function timelineFixture() {
  return [0, 1].map((frameIndex) => ({
    frameIndex,
    time: new Date(`2026-08-05T00:00:0${frameIndex}.000Z`),
    elevation: 30 + frameIndex,
    slantRange: 700 + frameIndex,
    rxPowerDbm: -90 + frameIndex,
    snrDb: 12 + frameIndex,
  }));
}

describe('statistical playback report', () => {
  it('adapts a selected pass timeline into statistical PDP playback frames', () => {
    const report = buildStatisticalPlaybackReport({
      timeline: timelineFixture(),
      windowId: 'pass:2026-08-05T00:00:00Z',
      satelliteName: 'TEST-SAT',
      receiver: { latitude_deg: 31, longitude_deg: 121, altitude_m: 15 },
      carrier: { frequency_Hz: 25e9, bandwidth_Hz: 100e6 },
      statisticalParameters: {
        environment: 'suburban',
        tec_TECU: 50,
        scatterPowerOffset_dB: 0,
      },
    });

    expect(report).toMatchObject({
      scenarioId: 'pass:2026-08-05T00:00:00Z',
      modelVersion: 'statistical-playback/v1',
      receiverGeometry: { mode: 'fixed-ground-station', frameCount: 2 },
      timeWindow: {
        source: 'selected-pass',
        startTimeUtc: '2026-08-05T00:00:00.000Z',
        endTimeUtc: '2026-08-05T00:00:01.000Z',
        sampleInterval_s: 1,
        frameCount: 2,
      },
      frames: [
        expect.objectContaining({
          frameId: 0,
          timestampUtc: '2026-08-05T00:00:00.000Z',
          receiver: expect.objectContaining({ latitude_deg: 31, longitude_deg: 121 }),
          geometry: expect.objectContaining({ elevation_deg: 30, slantRange_m: 700_000 }),
          link: { rxPower_dBm: -90, snr_dB: 12 },
          statistical: expect.objectContaining({
            realizationCount: 32,
            summary: expect.objectContaining({
              median: expect.any(Array),
              p5: expect.any(Array),
              p95: expect.any(Array),
            }),
            metricSummary: expect.objectContaining({
              rmsDelaySpread_s: expect.objectContaining({ median: expect.any(Number) }),
            }),
          }),
        }),
        expect.objectContaining({ frameId: 1 }),
      ],
    });
    expect(report.frames[0]).not.toHaveProperty('rt');
    expect(report.frames[0].statistical.summary.median).toHaveLength(
      report.frames[0].statistical.excessDelay_s.length,
    );
  });
});
