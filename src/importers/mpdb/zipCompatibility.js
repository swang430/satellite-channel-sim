const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;

function findLastSignature(bytes, signature) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.byteLength - 4; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === signature) return offset;
  }
  return -1;
}

export function normalizeRedundantZip64ForJsZip(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const eocdOffset = findLastSignature(bytes, EOCD_SIGNATURE);
  if (eocdOffset < 20) return bytes;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const locatorOffset = eocdOffset - 20;
  if (view.getUint32(locatorOffset, true) !== ZIP64_LOCATOR_SIGNATURE) return bytes;
  const zip64OffsetBigInt = view.getBigUint64(locatorOffset + 8, true);
  if (zip64OffsetBigInt > BigInt(Number.MAX_SAFE_INTEGER)) return bytes;
  const zip64Offset = Number(zip64OffsetBigInt);
  if (zip64Offset < 0
    || zip64Offset + 56 > bytes.byteLength
    || view.getUint32(zip64Offset, true) !== ZIP64_EOCD_SIGNATURE) {
    return bytes;
  }

  const normalized = bytes.slice();
  const normalizedView = new DataView(normalized.buffer);
  normalizedView.setUint16(eocdOffset + 4, 0xffff, true);
  normalizedView.setUint16(eocdOffset + 6, 0xffff, true);
  normalizedView.setUint16(eocdOffset + 8, 0xffff, true);
  normalizedView.setUint16(eocdOffset + 10, 0xffff, true);
  normalizedView.setUint32(eocdOffset + 12, 0xffffffff, true);
  normalizedView.setUint32(eocdOffset + 16, 0xffffffff, true);
  return normalized;
}

