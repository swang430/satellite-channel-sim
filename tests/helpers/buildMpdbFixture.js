import JSZip from 'jszip';
import { pickle } from './buildPickleFixture.js';

const encoder = new TextEncoder();

function int32Le(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, value, true);
  return bytes;
}

function encodeValue(value) {
  if (value === null) return pickle.op(0x4e);
  if (value === false) return pickle.op(0x89);
  if (value === true) return pickle.op(0x88);
  if (typeof value === 'string') return pickle.binUnicode(value);
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= 0 && value <= 0xff) {
      return pickle.op(0x4b, value);
    }
    if (Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff) {
      return pickle.concat(pickle.op(0x4a), int32Le(value));
    }
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value, false);
    return pickle.concat(pickle.op(0x47), bytes);
  }
  if (Array.isArray(value)) {
    return pickle.concat(
      pickle.op(0x5d, 0x28), // EMPTY_LIST, MARK
      ...value.map(encodeValue),
      pickle.op(0x65), // APPENDS
    );
  }
  if (value?.__tensor) return encodeTensor(value.__tensor);
  if (typeof value === 'object') {
    return pickle.concat(
      pickle.op(0x7d, 0x28), // EMPTY_DICT, MARK
      ...Object.entries(value).flatMap(([key, child]) => [pickle.binUnicode(key), encodeValue(child)]),
      pickle.op(0x75), // SETITEMS
    );
  }
  throw new TypeError(`Unsupported fixture value ${typeof value}`);
}

function encodeTuple(values) {
  if (values.length === 0) return pickle.op(0x29);
  if (values.length === 1) return pickle.concat(encodeValue(values[0]), pickle.op(0x85));
  if (values.length === 2) {
    return pickle.concat(encodeValue(values[0]), encodeValue(values[1]), pickle.op(0x86));
  }
  return pickle.concat(pickle.op(0x28), ...values.map(encodeValue), pickle.op(0x74));
}

function encodeTensor({ storageType, key, storageSize, shape, stride = [1] }) {
  const storagePersistentId = pickle.concat(
    pickle.op(0x28),
    pickle.binUnicode('storage'),
    pickle.global('torch', storageType),
    pickle.binUnicode(String(key)),
    pickle.binUnicode('cpu'),
    encodeValue(storageSize),
    pickle.op(0x74, 0x51), // TUPLE, BINPERSID
  );
  const hooks = pickle.concat(
    pickle.global('collections', 'OrderedDict'),
    pickle.op(0x29, 0x52), // EMPTY_TUPLE, REDUCE
  );
  return pickle.concat(
    pickle.global('torch._utils', '_rebuild_tensor_v2'),
    pickle.op(0x28),
    storagePersistentId,
    encodeValue(0),
    encodeTuple(shape),
    encodeTuple(stride),
    encodeValue(false),
    hooks,
    pickle.op(0x74, 0x52), // TUPLE, REDUCE
  );
}

function contiguousStride(shape) {
  const stride = new Array(shape.length);
  let next = 1;
  for (let index = shape.length - 1; index >= 0; index -= 1) {
    stride[index] = next;
    next *= shape[index];
  }
  return stride;
}

function tensor(storageType, key, storageSize, shape = [storageSize]) {
  return {
    __tensor: {
      storageType,
      key,
      storageSize,
      shape,
      stride: contiguousStride(shape),
    },
  };
}

function encodePickleRoot(root) {
  return pickle.concat(pickle.proto2(), encodeValue(root), pickle.op(0x2e));
}

function encodeLong(values) {
  const bytes = new Uint8Array(values.length * 8);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setBigInt64(index * 8, BigInt(value), true));
  return bytes;
}

function encodeFloat(values) {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return bytes;
}

export async function buildMpdbFixture({
  linkIds = [0, 0, 1],
  omitColumn = null,
  corruptStorageKey = null,
} = {}) {
  const channelColumns = {
    LINK_ID: tensor('LongStorage', '0', 3),
    CHANNEL_TYPE: tensor('LongStorage', '1', 3),
    DELAY: tensor('FloatStorage', '2', 3),
    H: tensor('ComplexFloatStorage', '3', 3),
    AOA: tensor('FloatStorage', '4', 3),
    ZOA: tensor('FloatStorage', '5', 3),
    AOD: tensor('FloatStorage', '6', 3),
    ZOD: tensor('FloatStorage', '7', 3),
    PATH_LENGTH: tensor('FloatStorage', '8', 3),
    DOPPLER: tensor('FloatStorage', '9', 3),
  };
  if (omitColumn) delete channelColumns[omitColumn];

  const root = {
    records: {
      CHANNEL: { columns: channelColumns },
      LINK: {
        columns: {
          LINK_ID: tensor('LongStorage', '10', 2),
          FRAME_ID: tensor('LongStorage', '11', 2),
          TX: tensor('LongStorage', '12', 2),
          RX: tensor('LongStorage', '13', 2),
          TX_ANT: tensor('LongStorage', '14', 2),
          RX_ANT: tensor('LongStorage', '15', 2),
          TX_ANT_POSITION: tensor('FloatStorage', '16', 6, [2, 3]),
          RX_ANT_POSITION: tensor('FloatStorage', '17', 6, [2, 3]),
          FREQUENCY: tensor('LongStorage', '18', 2),
        },
      },
    },
    meta: {
      mode: 'CIR',
      numFrequency: 1,
      route_link: {
        direction: 'downlink',
        transmitter: { id: '47641' },
        receiver: { id: 'terminal-1' },
      },
    },
  };

  const storages = new Map([
    ['0', encodeLong(linkIds)],
    ['1', encodeLong([0, 2, 0])],
    ['2', encodeFloat([0.003, 0.0030001, 0.002])],
    ['3', encodeFloat([1, 0, 0.5, -0.5, 0.25, 0.75])],
    ['4', encodeFloat([1, 2, 3])],
    ['5', encodeFloat([4, 5, 6])],
    ['6', encodeFloat([7, 8, 9])],
    ['7', encodeFloat([10, 11, 12])],
    ['8', encodeFloat([900_000, 900_030, 600_000])],
    ['9', encodeFloat([-1, 2, 3])],
    ['10', encodeLong([0, 1])],
    ['11', encodeLong([0, 1])],
    ['12', encodeLong([0, 0])],
    ['13', encodeLong([0, 0])],
    ['14', encodeLong([0, 0])],
    ['15', encodeLong([0, 0])],
    ['16', encodeFloat([-900_000, -180_000, 235_000, -893_000, -175_000, 235_010])],
    ['17', encodeFloat([-1_547, -313, -40, -1_547, -313, -40])],
    ['18', encodeLong([24_950_000_000, 24_950_000_000])],
  ]);
  if (corruptStorageKey) {
    const current = storages.get(corruptStorageKey);
    storages.set(corruptStorageKey, current.subarray(0, current.length - 1));
  }

  const zip = new JSZip();
  zip.file('archive/data.pkl', encodePickleRoot(root));
  zip.file('archive/byteorder', encoder.encode('little'));
  zip.file('archive/version', encoder.encode('3\n'));
  for (const [key, bytes] of storages) zip.file(`archive/data/${key}`, bytes);
  return zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
}
