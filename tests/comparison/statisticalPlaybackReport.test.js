import { describe, expect, it } from 'vitest';
import { buildStatisticalPlaybackReport } from '../../src/features/channel-comparison/statisticalPlaybackReport.js';

function timelineFixture() {
  return [0, 1].map((frameIndex) => ({
    frameIndex,
    time: new Date(`2026-08-05T00:00:0${frameIndex}.000Z`),
    elevation: 30 + frameIndex,
    slantRange: 700 + frameIndex,
    rxPowerDbm: -90 + frameIndex,
    noiseFloorDbm: -102 + frameIndex,
    snrDb: 12 + frameIndex,
    absoluteFspl: 177 + frameIndex,
    attRain: 1 + frameIndex,
    attGas: 2 + frameIndex,
    attCloud: 3 + frameIndex,
    fadeLMS: 4 + frameIndex,
    lossFaraday: 5 + frameIndex,
    pointingLoss: 6 + frameIndex,
    scanLoss: 7 + frameIndex,
    multipathLoss: -2 + frameIndex,
    scintLoss: 0.5 + frameIndex,
    xpd: 28 + frameIndex,
    capRank1: 4 + frameIndex,
    capRank2: 6 + frameIndex,
    groupDelayNs: 8 + frameIndex,
    dispersionNs: 9 + frameIndex,
    dopplerHz: 12_345 + frameIndex,
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

  it('adapts existing selected-pass link values without recomputing them and preserves Doppler', () => {
    const timeline = timelineFixture();
    const report = buildStatisticalPlaybackReport({
      timeline,
      windowId: 'pass:existing-values',
      receiver: { latitude_deg: 31, longitude_deg: 121, altitude_m: 15 },
      carrier: { frequency_Hz: 25e9, bandwidth_Hz: 100e6 },
      statisticalParameters: { environment: 'suburban', tec_TECU: 50 },
      realizationCount: 2,
    });
    const frame = report.frames[0];

    expect(frame.statistical.linkBudget).toMatchObject({
      loss: {
        method: 'statistical-link-budget/v1',
        fspl_dB: timeline[0].absoluteFspl,
        components_dB: {
          rain: timeline[0].attRain,
          gas: timeline[0].attGas,
          cloud: timeline[0].attCloud,
          shadow: timeline[0].fadeLMS,
          faraday: timeline[0].lossFaraday,
          pointing: timeline[0].pointingLoss,
          scan: timeline[0].scanLoss,
          multipath: timeline[0].multipathLoss,
          scintillation: timeline[0].scintLoss,
        },
      },
      link: {
        rxPower_dBm: timeline[0].rxPowerDbm,
        noisePower_dBm: timeline[0].noiseFloorDbm,
        snr_dB: timeline[0].snrDb,
        xpd_dB: timeline[0].xpd,
        capacity_bpsHz: { rank1: timeline[0].capRank1, rank2: timeline[0].capRank2 },
      },
      delay: {
        ionosphericGroupDelay_s: timeline[0].groupDelayNs * 1e-9,
        ionosphericDispersion_s: timeline[0].dispersionNs * 1e-9,
      },
      sources: { values: 'selected-pass-timeline' },
    });
    expect(frame.statistical.linkBudget.loss.totalPropagationLoss_dB).toBeCloseTo(
      timeline[0].absoluteFspl
        + timeline[0].attRain + timeline[0].attGas + timeline[0].attCloud
        + timeline[0].fadeLMS + timeline[0].lossFaraday + timeline[0].pointingLoss
        + timeline[0].scanLoss + timeline[0].multipathLoss + timeline[0].scintLoss,
      12,
    );
    expect(frame.dopplerHz).toBe(timeline[0].dopplerHz);
    expect(frame.statistical.doppler).toEqual({
      geometric_Hz: timeline[0].dopplerHz,
      method: 'sgp4-range-rate',
    });
  });
});
