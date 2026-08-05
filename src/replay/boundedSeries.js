export function appendBounded(series, value, limit = 3600) {
  if (!Number.isInteger(limit) || limit <= 0) throw new TypeError('series limit must be a positive integer');
  const source = Array.isArray(series) ? series : [];
  if (source.length < limit) return [...source, value];
  return [...source.slice(source.length - limit + 1), value];
}
