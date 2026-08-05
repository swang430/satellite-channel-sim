export function summarizeModcodTimeline(timeline) {
  if (!Array.isArray(timeline) || timeline.length === 0) {
    return { status: 'empty', best: null };
  }
  const available = timeline.filter((sample) => (
    sample.status !== 'outage'
    && Number.isFinite(sample.spectralEfficiency_bpsHz)
  ));
  if (available.length === 0) return { status: 'empty', best: null };
  const best = available.reduce((current, sample) => (
    sample.spectralEfficiency_bpsHz > current.spectralEfficiency_bpsHz ? sample : current
  ));
  return { status: 'available', best };
}
