function relativeDb(value, reference) {
  return value > 0 && reference > 0 ? 10 * Math.log10(value / reference) : -120;
}

export function buildComparisonPlotData(frame) {
  const reference = Math.max(...frame.statistical.summary.median, 0);
  const series = (values) => values.map((value, index) => ({
    x: frame.statistical.excessDelay_s[index] * 1e9,
    y: relativeDb(value, reference),
  }));
  return {
    rt: frame.rt.pdp.bins.map((bin) => ({
      x: bin.excessDelay_s * 1e9,
      y: Number.isFinite(bin.relativePower_dB) ? bin.relativePower_dB : -120,
    })),
    statisticalMedian: series(frame.statistical.summary.median),
    statisticalP5: series(frame.statistical.summary.p5),
    statisticalP95: series(frame.statistical.summary.p95),
  };
}

