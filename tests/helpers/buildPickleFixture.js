const encoder = new TextEncoder();

function concat(...parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function uint32Le(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

export const pickle = {
  concat,
  op(...values) {
    return Uint8Array.from(values);
  },
  proto2() {
    return Uint8Array.from([0x80, 0x02]);
  },
  binUnicode(value) {
    const bytes = encoder.encode(value);
    return concat(Uint8Array.from([0x58]), uint32Le(bytes.length), bytes);
  },
  global(moduleName, symbolName) {
    return concat(
      Uint8Array.from([0x63]),
      encoder.encode(`${moduleName}\n${symbolName}\n`),
    );
  },
};

export function buildSimplePickle() {
  return concat(
    pickle.proto2(),
    pickle.op(0x7d), // EMPTY_DICT
    pickle.op(0x28), // MARK
    pickle.binUnicode('answer'),
    pickle.op(0x4b, 42), // BININT1
    pickle.binUnicode('items'),
    pickle.op(0x5d), // EMPTY_LIST
    pickle.op(0x28), // MARK
    pickle.op(0x4b, 1, 0x4b, 2),
    pickle.op(0x65), // APPENDS
    pickle.op(0x75), // SETITEMS
    pickle.op(0x2e), // STOP
  );
}

export function buildAllowedGlobalPickle() {
  return concat(
    pickle.proto2(),
    pickle.global('collections', 'OrderedDict'),
    pickle.op(0x29), // EMPTY_TUPLE
    pickle.op(0x52), // REDUCE
    pickle.op(0x2e),
  );
}

export function buildUnknownGlobalPickle() {
  return concat(
    pickle.proto2(),
    pickle.global('os', 'system'),
    pickle.op(0x2e),
  );
}
