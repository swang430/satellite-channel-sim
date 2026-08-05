import { DomainValidationError } from '../../domain/validation.js';

const CHANNEL_COLUMNS = [
  'LINK_ID',
  'CHANNEL_TYPE',
  'DELAY',
  'H',
  'AOA',
  'ZOA',
  'AOD',
  'ZOD',
  'PATH_LENGTH',
  'DOPPLER',
];

const LINK_COLUMNS = [
  'LINK_ID',
  'FRAME_ID',
  'TX',
  'RX',
  'TX_ANT',
  'RX_ANT',
  'TX_ANT_POSITION',
  'RX_ANT_POSITION',
  'FREQUENCY',
];

const STORAGE_LAYOUT = Object.freeze({
  'torch LongStorage': { bytesPerElement: 8, kind: 'long' },
  'torch FloatStorage': { bytesPerElement: 4, kind: 'float' },
  'torch ComplexFloatStorage': { bytesPerElement: 8, kind: 'complex-float' },
  'torch IntStorage': { bytesPerElement: 4, kind: 'int' },
});

function getTableColumns(root, tableName) {
  const columns = root?.records?.[tableName]?.columns;
  if (!columns || typeof columns !== 'object') {
    throw new DomainValidationError('MPDB_TABLE_MISSING', `MPDB table ${tableName} is missing`);
  }
  return columns;
}

function getTensor(columns, columnName) {
  const column = columns[columnName];
  if (!column) {
    throw new DomainValidationError('MPDB_COLUMN_MISSING', `MPDB column ${columnName} is missing`);
  }
  const tensor = column.data ?? column;
  if (tensor?.__pickleType !== 'torch.Tensor') {
    throw new DomainValidationError(
      'MPDB_COLUMN_TYPE_INVALID',
      `MPDB column ${columnName} is not a Tensor`,
    );
  }
  return tensor;
}

function tensorElementCount(shape) {
  if (!Array.isArray(shape) || shape.length === 0) {
    throw new DomainValidationError('TORCH_TENSOR_SHAPE_INVALID', 'Tensor shape must be non-empty');
  }
  let count = 1;
  for (const dimension of shape) {
    if (!Number.isInteger(dimension) || dimension < 0) {
      throw new DomainValidationError('TORCH_TENSOR_SHAPE_INVALID', 'Tensor dimensions must be non-negative integers');
    }
    count *= dimension;
    if (!Number.isSafeInteger(count)) {
      throw new DomainValidationError('TORCH_TENSOR_SHAPE_INVALID', 'Tensor element count is not safe');
    }
  }
  return count;
}

function expectedContiguousStride(shape) {
  const stride = new Array(shape.length);
  let next = 1;
  for (let index = shape.length - 1; index >= 0; index -= 1) {
    stride[index] = next;
    next *= shape[index];
  }
  return stride;
}

function assertContiguous(tensor) {
  const expected = expectedContiguousStride(tensor.size);
  if (!Array.isArray(tensor.stride)
    || tensor.stride.length !== expected.length
    || tensor.stride.some((value, index) => value !== expected[index])) {
    throw new DomainValidationError(
      'TORCH_TENSOR_STRIDE_NOT_SUPPORTED',
      'Only contiguous PyTorch tensors are supported',
    );
  }
}

async function decodeTensor(archive, tensor) {
  const storage = tensor.storage;
  const layout = STORAGE_LAYOUT[storage?.storageType];
  if (!layout) {
    throw new DomainValidationError(
      'TORCH_STORAGE_TYPE_NOT_SUPPORTED',
      `Unsupported PyTorch storage type ${storage?.storageType}`,
    );
  }
  if (!Number.isInteger(storage.size) || storage.size < 0) {
    throw new DomainValidationError('TORCH_STORAGE_SIZE_INVALID', 'Storage size must be a non-negative integer');
  }
  const bytes = await archive.readStorage(storage.key);
  const expectedBytes = storage.size * layout.bytesPerElement;
  if (bytes.byteLength !== expectedBytes) {
    throw new DomainValidationError(
      'TORCH_STORAGE_LENGTH_MISMATCH',
      `Storage ${storage.key} has ${bytes.byteLength} bytes, expected ${expectedBytes}`,
    );
  }
  assertContiguous(tensor);
  const elementCount = tensorElementCount(tensor.size);
  const storageOffset = tensor.storageOffset;
  if (!Number.isInteger(storageOffset)
    || storageOffset < 0
    || storageOffset + elementCount > storage.size) {
    throw new DomainValidationError('TORCH_TENSOR_BOUNDS_INVALID', 'Tensor exceeds its backing storage');
  }

  const littleEndian = archive.byteorder === 'little';
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  switch (layout.kind) {
    case 'long': {
      const values = new BigInt64Array(elementCount);
      for (let index = 0; index < elementCount; index += 1) {
        values[index] = view.getBigInt64((storageOffset + index) * 8, littleEndian);
      }
      return values;
    }
    case 'int': {
      const values = new Int32Array(elementCount);
      for (let index = 0; index < elementCount; index += 1) {
        values[index] = view.getInt32((storageOffset + index) * 4, littleEndian);
      }
      return values;
    }
    case 'float': {
      const values = new Float32Array(elementCount);
      for (let index = 0; index < elementCount; index += 1) {
        values[index] = view.getFloat32((storageOffset + index) * 4, littleEndian);
      }
      return values;
    }
    case 'complex-float': {
      const real = new Float32Array(elementCount);
      const imag = new Float32Array(elementCount);
      for (let index = 0; index < elementCount; index += 1) {
        const byteOffset = (storageOffset + index) * 8;
        real[index] = view.getFloat32(byteOffset, littleEndian);
        imag[index] = view.getFloat32(byteOffset + 4, littleEndian);
      }
      return { real, imag };
    }
    default:
      throw new DomainValidationError('TORCH_STORAGE_TYPE_NOT_SUPPORTED', 'Unsupported storage layout');
  }
}

function longToInt32(values, columnName) {
  const result = new Int32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    const value = Number(values[index]);
    if (!Number.isSafeInteger(value) || value < -2_147_483_648 || value > 2_147_483_647) {
      throw new DomainValidationError(
        'MPDB_INTEGER_RANGE_INVALID',
        `${columnName}[${index}] does not fit Int32`,
      );
    }
    result[index] = value;
  }
  return result;
}

function longToInt16(values, columnName) {
  const result = new Int16Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    const value = Number(values[index]);
    if (!Number.isSafeInteger(value) || value < -32_768 || value > 32_767) {
      throw new DomainValidationError(
        'MPDB_INTEGER_RANGE_INVALID',
        `${columnName}[${index}] does not fit Int16`,
      );
    }
    result[index] = value;
  }
  return result;
}

function longToFloat64(values, columnName) {
  const result = new Float64Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    const value = Number(values[index]);
    if (!Number.isSafeInteger(value)) {
      throw new DomainValidationError(
        'MPDB_INTEGER_RANGE_INVALID',
        `${columnName}[${index}] is not a safe JavaScript integer`,
      );
    }
    result[index] = value;
  }
  return result;
}

function assertColumnLengths(columns, expectedLength, tableName, recordWidths = {}) {
  for (const [name, values] of Object.entries(columns)) {
    const length = values?.real?.length ?? values.length;
    const expectedElementLength = expectedLength * (recordWidths[name] ?? 1);
    if (length !== expectedElementLength) {
      throw new DomainValidationError(
        'MPDB_COLUMN_LENGTH_MISMATCH',
        `${tableName}.${name} has ${length} values, expected ${expectedElementLength}`,
      );
    }
  }
}

function buildFrameOffsets(linkId, frameCount) {
  const offsets = new Uint32Array(frameCount + 1);
  let previous = -1;
  for (let index = 0; index < linkId.length; index += 1) {
    const current = linkId[index];
    if (current < previous) {
      throw new DomainValidationError(
        'MPDB_LINK_ID_NOT_MONOTONIC',
        `CHANNEL.LINK_ID decreases at ray ${index}`,
      );
    }
    if (current < 0 || current >= frameCount) {
      throw new DomainValidationError(
        'MPDB_LINK_ID_OUT_OF_RANGE',
        `CHANNEL.LINK_ID ${current} is outside the LINK table`,
      );
    }
    previous = current;
  }
  let rayIndex = 0;
  for (let frameId = 0; frameId <= frameCount; frameId += 1) {
    while (rayIndex < linkId.length && linkId[rayIndex] < frameId) rayIndex += 1;
    offsets[frameId] = rayIndex;
  }
  return offsets;
}

export async function readMpdbColumns(archive) {
  const channelTable = getTableColumns(archive.root, 'CHANNEL');
  const linkTable = getTableColumns(archive.root, 'LINK');
  CHANNEL_COLUMNS.forEach((name) => getTensor(channelTable, name));
  LINK_COLUMNS.forEach((name) => getTensor(linkTable, name));

  const decodedChannel = Object.fromEntries(await Promise.all(CHANNEL_COLUMNS.map(async (name) => [
    name,
    await decodeTensor(archive, getTensor(channelTable, name)),
  ])));
  const decodedLink = Object.fromEntries(await Promise.all(LINK_COLUMNS.map(async (name) => [
    name,
    await decodeTensor(archive, getTensor(linkTable, name)),
  ])));

  const rayCount = decodedChannel.LINK_ID.length;
  const frameCount = decodedLink.FRAME_ID.length;
  if (rayCount > archive.limits.maxRays || frameCount > archive.limits.maxFrames) {
    throw new DomainValidationError('MPDB_RECORD_LIMIT', 'MPDB record count exceeds configured limits');
  }
  assertColumnLengths(decodedChannel, rayCount, 'CHANNEL');
  assertColumnLengths(decodedLink, frameCount, 'LINK', {
    TX_ANT_POSITION: 3,
    RX_ANT_POSITION: 3,
  });

  const linkId = longToInt32(decodedChannel.LINK_ID, 'CHANNEL.LINK_ID');
  const linkFrameId = longToInt32(decodedLink.FRAME_ID, 'LINK.FRAME_ID');
  for (let frameId = 0; frameId < frameCount; frameId += 1) {
    if (linkFrameId[frameId] !== frameId) {
      throw new DomainValidationError(
        'MPDB_FRAME_ID_SEQUENCE_INVALID',
        `Expected LINK.FRAME_ID ${frameId}, got ${linkFrameId[frameId]}`,
      );
    }
  }

  return {
    frameCount,
    rayCount,
    meta: archive.root.meta ?? {},
    rayTracing: {
      frameOffsets: buildFrameOffsets(linkId, frameCount),
      linkId,
      channelType: longToInt16(decodedChannel.CHANNEL_TYPE, 'CHANNEL.CHANNEL_TYPE'),
      delay_s: decodedChannel.DELAY,
      hReal: decodedChannel.H.real,
      hImag: decodedChannel.H.imag,
      aoa_deg: decodedChannel.AOA,
      zoa_deg: decodedChannel.ZOA,
      aod_deg: decodedChannel.AOD,
      zod_deg: decodedChannel.ZOD,
      pathLength_m: decodedChannel.PATH_LENGTH,
      doppler_Hz: decodedChannel.DOPPLER,
    },
    linkFrames: {
      linkId: longToInt32(decodedLink.LINK_ID, 'LINK.LINK_ID'),
      frameId: linkFrameId,
      transmitterIndex: longToInt32(decodedLink.TX, 'LINK.TX'),
      receiverIndex: longToInt32(decodedLink.RX, 'LINK.RX'),
      transmitterAntennaIndex: longToInt32(decodedLink.TX_ANT, 'LINK.TX_ANT'),
      receiverAntennaIndex: longToInt32(decodedLink.RX_ANT, 'LINK.RX_ANT'),
      txPosition_m: decodedLink.TX_ANT_POSITION,
      rxPosition_m: decodedLink.RX_ANT_POSITION,
      frequency_Hz: longToFloat64(decodedLink.FREQUENCY, 'LINK.FREQUENCY'),
    },
  };
}
