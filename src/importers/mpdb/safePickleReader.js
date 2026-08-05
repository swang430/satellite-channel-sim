import { DomainValidationError } from '../../domain/validation.js';
import { PICKLE_OPCODE, PICKLE_OPCODE_NAME } from './pickleOpcodes.js';

const MARKER = Symbol('pickle-marker');
const textDecoder = new TextDecoder('utf-8', { fatal: true });
const asciiDecoder = new TextDecoder('ascii', { fatal: true });

const ALLOWED_GLOBALS = new Set([
  'HyperRT.MiRT.MPDB.MPDBMS Table',
  'HyperRT.MiRT.MPDB.MPDBMS Column',
  'torch._utils _rebuild_tensor_v2',
  'torch LongStorage',
  'torch FloatStorage',
  'torch ComplexFloatStorage',
  'torch IntStorage',
  'collections OrderedDict',
]);

const DEFAULT_LIMITS = Object.freeze({
  maxOperations: 20_000_000,
  maxMemoEntries: 5_000_000,
  maxContainerLength: 1_000_000,
  maxStringLength: 1_000_000,
  maxStackDepth: 5_000_000,
});

function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new TypeError('Pickle input must be an ArrayBuffer or Uint8Array');
}

function parserError(code, message, offset) {
  const error = new DomainValidationError(code, message);
  error.offset = offset;
  throw error;
}

function isPlainDataObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function readSafePickle(input, requestedLimits = {}) {
  const bytes = asBytes(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const limits = { ...DEFAULT_LIMITS, ...requestedLimits };
  const stack = [];
  const memo = [];
  let offset = 0;
  let operations = 0;
  let protocol = null;

  function ensure(count, opcodeOffset) {
    if (offset + count > bytes.length) {
      parserError('PICKLE_TRUNCATED', 'Unexpected end of Pickle payload', opcodeOffset);
    }
  }

  function pop(opcodeOffset) {
    if (stack.length === 0) {
      parserError('PICKLE_STACK_UNDERFLOW', 'Pickle stack underflow', opcodeOffset);
    }
    return stack.pop();
  }

  function push(value, opcodeOffset) {
    if (stack.length >= limits.maxStackDepth) {
      parserError('PICKLE_STACK_LIMIT', 'Pickle stack depth limit exceeded', opcodeOffset);
    }
    stack.push(value);
  }

  function findMarker(opcodeOffset) {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      if (stack[index] === MARKER) return index;
    }
    parserError('PICKLE_MARK_MISSING', 'Pickle MARK not found', opcodeOffset);
  }

  function assertContainerLength(length, opcodeOffset) {
    if (length > limits.maxContainerLength) {
      parserError('PICKLE_CONTAINER_LIMIT', 'Pickle container length limit exceeded', opcodeOffset);
    }
  }

  function readUint8(opcodeOffset) {
    ensure(1, opcodeOffset);
    const value = view.getUint8(offset);
    offset += 1;
    return value;
  }

  function readUint16Le(opcodeOffset) {
    ensure(2, opcodeOffset);
    const value = view.getUint16(offset, true);
    offset += 2;
    return value;
  }

  function readUint32Le(opcodeOffset) {
    ensure(4, opcodeOffset);
    const value = view.getUint32(offset, true);
    offset += 4;
    return value;
  }

  function readInt32Le(opcodeOffset) {
    ensure(4, opcodeOffset);
    const value = view.getInt32(offset, true);
    offset += 4;
    return value;
  }

  function readLine(opcodeOffset) {
    const start = offset;
    while (offset < bytes.length && bytes[offset] !== 0x0a) offset += 1;
    if (offset >= bytes.length) {
      parserError('PICKLE_TRUNCATED', 'Unterminated Pickle line', opcodeOffset);
    }
    const value = asciiDecoder.decode(bytes.subarray(start, offset));
    offset += 1;
    return value;
  }

  function readUnicode(opcodeOffset) {
    const length = readUint32Le(opcodeOffset);
    if (length > limits.maxStringLength) {
      parserError('PICKLE_STRING_LIMIT', 'Pickle string length limit exceeded', opcodeOffset);
    }
    ensure(length, opcodeOffset);
    let value;
    try {
      value = textDecoder.decode(bytes.subarray(offset, offset + length));
    } catch {
      parserError('PICKLE_STRING_INVALID', 'Invalid UTF-8 in Pickle string', opcodeOffset);
    }
    offset += length;
    return value;
  }

  function memoStore(index, value, opcodeOffset) {
    if (index >= limits.maxMemoEntries) {
      parserError('PICKLE_MEMO_LIMIT', 'Pickle memo entry limit exceeded', opcodeOffset);
    }
    memo[index] = value;
  }

  function memoGet(index, opcodeOffset) {
    if (index >= memo.length || !(index in memo)) {
      parserError('PICKLE_MEMO_REFERENCE_INVALID', `Unknown Pickle memo ${index}`, opcodeOffset);
    }
    return memo[index];
  }

  function reduceAllowed(callable, args, opcodeOffset) {
    if (!callable || callable.__pickleGlobal === undefined) {
      parserError('PICKLE_REDUCER_NOT_ALLOWED', 'Reducer is not an allowlisted global', opcodeOffset);
    }
    switch (callable.__pickleGlobal) {
      case 'collections OrderedDict':
        return {};
      case 'torch._utils _rebuild_tensor_v2': {
        const [storage, storageOffset, size, stride, requiresGrad, hooks] = args;
        return {
          __pickleType: 'torch.Tensor',
          storage,
          storageOffset,
          size,
          stride,
          requiresGrad,
          hooks,
        };
      }
      default:
        parserError(
          'PICKLE_REDUCER_NOT_ALLOWED',
          `Global ${callable.__pickleGlobal} cannot be called as a reducer`,
          opcodeOffset,
        );
    }
  }

  while (offset < bytes.length) {
    const opcodeOffset = offset;
    const opcode = bytes[offset];
    offset += 1;
    operations += 1;
    if (operations > limits.maxOperations) {
      parserError('PICKLE_OPERATION_LIMIT', 'Pickle operation limit exceeded', opcodeOffset);
    }

    switch (opcode) {
      case PICKLE_OPCODE.PROTO: {
        const version = readUint8(opcodeOffset);
        if (protocol !== null || version !== 2) {
          parserError('PICKLE_PROTOCOL_NOT_SUPPORTED', `Unsupported Pickle protocol ${version}`, opcodeOffset);
        }
        protocol = version;
        break;
      }
      case PICKLE_OPCODE.MARK:
        push(MARKER, opcodeOffset);
        break;
      case PICKLE_OPCODE.EMPTY_DICT:
        push({}, opcodeOffset);
        break;
      case PICKLE_OPCODE.EMPTY_LIST:
        push([], opcodeOffset);
        break;
      case PICKLE_OPCODE.EMPTY_TUPLE:
        push([], opcodeOffset);
        break;
      case PICKLE_OPCODE.NONE:
        push(null, opcodeOffset);
        break;
      case PICKLE_OPCODE.NEWTRUE:
        push(true, opcodeOffset);
        break;
      case PICKLE_OPCODE.NEWFALSE:
        push(false, opcodeOffset);
        break;
      case PICKLE_OPCODE.BININT:
        push(readInt32Le(opcodeOffset), opcodeOffset);
        break;
      case PICKLE_OPCODE.BININT1:
        push(readUint8(opcodeOffset), opcodeOffset);
        break;
      case PICKLE_OPCODE.BININT2:
        push(readUint16Le(opcodeOffset), opcodeOffset);
        break;
      case PICKLE_OPCODE.BINFLOAT: {
        ensure(8, opcodeOffset);
        const value = view.getFloat64(offset, false);
        offset += 8;
        push(value, opcodeOffset);
        break;
      }
      case PICKLE_OPCODE.BINUNICODE:
        push(readUnicode(opcodeOffset), opcodeOffset);
        break;
      case PICKLE_OPCODE.GLOBAL: {
        const moduleName = readLine(opcodeOffset);
        const symbolName = readLine(opcodeOffset);
        const globalName = `${moduleName} ${symbolName}`;
        if (!ALLOWED_GLOBALS.has(globalName)) {
          parserError(
            'PICKLE_GLOBAL_NOT_ALLOWED',
            `Pickle global ${globalName} is not allowlisted`,
            opcodeOffset,
          );
        }
        push({ __pickleGlobal: globalName }, opcodeOffset);
        break;
      }
      case PICKLE_OPCODE.BINPUT: {
        const index = readUint8(opcodeOffset);
        if (stack.length === 0) pop(opcodeOffset);
        memoStore(index, stack.at(-1), opcodeOffset);
        break;
      }
      case PICKLE_OPCODE.LONG_BINPUT: {
        const index = readUint32Le(opcodeOffset);
        if (stack.length === 0) pop(opcodeOffset);
        memoStore(index, stack.at(-1), opcodeOffset);
        break;
      }
      case PICKLE_OPCODE.BINGET:
        push(memoGet(readUint8(opcodeOffset), opcodeOffset), opcodeOffset);
        break;
      case PICKLE_OPCODE.LONG_BINGET:
        push(memoGet(readUint32Le(opcodeOffset), opcodeOffset), opcodeOffset);
        break;
      case PICKLE_OPCODE.TUPLE: {
        const markerIndex = findMarker(opcodeOffset);
        const tuple = stack.slice(markerIndex + 1);
        assertContainerLength(tuple.length, opcodeOffset);
        stack.length = markerIndex;
        push(tuple, opcodeOffset);
        break;
      }
      case PICKLE_OPCODE.TUPLE1: {
        const first = pop(opcodeOffset);
        push([first], opcodeOffset);
        break;
      }
      case PICKLE_OPCODE.TUPLE2: {
        const second = pop(opcodeOffset);
        const first = pop(opcodeOffset);
        push([first, second], opcodeOffset);
        break;
      }
      case PICKLE_OPCODE.TUPLE3: {
        const third = pop(opcodeOffset);
        const second = pop(opcodeOffset);
        const first = pop(opcodeOffset);
        push([first, second, third], opcodeOffset);
        break;
      }
      case PICKLE_OPCODE.APPEND: {
        const value = pop(opcodeOffset);
        const list = pop(opcodeOffset);
        if (!Array.isArray(list)) {
          parserError('PICKLE_CONTAINER_TYPE_INVALID', 'APPEND target must be a list', opcodeOffset);
        }
        assertContainerLength(list.length + 1, opcodeOffset);
        list.push(value);
        push(list, opcodeOffset);
        break;
      }
      case PICKLE_OPCODE.APPENDS: {
        const markerIndex = findMarker(opcodeOffset);
        if (markerIndex === 0 || !Array.isArray(stack[markerIndex - 1])) {
          parserError('PICKLE_CONTAINER_TYPE_INVALID', 'APPENDS target must be a list', opcodeOffset);
        }
        const list = stack[markerIndex - 1];
        const items = stack.slice(markerIndex + 1);
        assertContainerLength(list.length + items.length, opcodeOffset);
        list.push(...items);
        stack.length = markerIndex;
        break;
      }
      case PICKLE_OPCODE.SETITEM: {
        const value = pop(opcodeOffset);
        const key = pop(opcodeOffset);
        const dictionary = pop(opcodeOffset);
        if (!isPlainDataObject(dictionary)) {
          parserError('PICKLE_CONTAINER_TYPE_INVALID', 'SETITEM target must be a dictionary', opcodeOffset);
        }
        dictionary[key] = value;
        assertContainerLength(Object.keys(dictionary).length, opcodeOffset);
        push(dictionary, opcodeOffset);
        break;
      }
      case PICKLE_OPCODE.SETITEMS: {
        const markerIndex = findMarker(opcodeOffset);
        if (markerIndex === 0 || !isPlainDataObject(stack[markerIndex - 1])) {
          parserError('PICKLE_CONTAINER_TYPE_INVALID', 'SETITEMS target must be a dictionary', opcodeOffset);
        }
        const dictionary = stack[markerIndex - 1];
        const items = stack.slice(markerIndex + 1);
        if (items.length % 2 !== 0) {
          parserError('PICKLE_SETITEMS_INVALID', 'SETITEMS requires key/value pairs', opcodeOffset);
        }
        assertContainerLength(Object.keys(dictionary).length + items.length / 2, opcodeOffset);
        for (let index = 0; index < items.length; index += 2) {
          dictionary[items[index]] = items[index + 1];
        }
        stack.length = markerIndex;
        break;
      }
      case PICKLE_OPCODE.BINPERSID: {
        const persistentId = pop(opcodeOffset);
        if (!Array.isArray(persistentId)
          || persistentId[0] !== 'storage'
          || !persistentId[1]?.__pickleGlobal) {
          parserError('PICKLE_PERSISTENT_ID_NOT_ALLOWED', 'Unsupported persistent ID', opcodeOffset);
        }
        push({
          __pickleType: 'torch.Storage',
          storageType: persistentId[1].__pickleGlobal,
          key: String(persistentId[2]),
          location: persistentId[3],
          size: persistentId[4],
        }, opcodeOffset);
        break;
      }
      case PICKLE_OPCODE.REDUCE: {
        const args = pop(opcodeOffset);
        const callable = pop(opcodeOffset);
        if (!Array.isArray(args)) {
          parserError('PICKLE_REDUCE_ARGS_INVALID', 'REDUCE arguments must be a tuple', opcodeOffset);
        }
        push(reduceAllowed(callable, args, opcodeOffset), opcodeOffset);
        break;
      }
      case PICKLE_OPCODE.NEWOBJ: {
        const args = pop(opcodeOffset);
        const constructor = pop(opcodeOffset);
        if (!Array.isArray(args) || !constructor?.__pickleGlobal) {
          parserError('PICKLE_NEWOBJ_NOT_ALLOWED', 'NEWOBJ requires an allowlisted class', opcodeOffset);
        }
        if (!constructor.__pickleGlobal.startsWith('HyperRT.MiRT.MPDB.MPDBMS ')) {
          parserError('PICKLE_NEWOBJ_NOT_ALLOWED', 'Only MPDB data classes may use NEWOBJ', opcodeOffset);
        }
        push({
          __pickleType: constructor.__pickleGlobal,
          __pickleArgs: args,
        }, opcodeOffset);
        break;
      }
      case PICKLE_OPCODE.BUILD: {
        const state = pop(opcodeOffset);
        const instance = pop(opcodeOffset);
        if (!isPlainDataObject(instance) || !isPlainDataObject(state)) {
          parserError('PICKLE_BUILD_NOT_ALLOWED', 'BUILD requires an MPDB data object and plain state', opcodeOffset);
        }
        Object.assign(instance, state);
        push(instance, opcodeOffset);
        break;
      }
      case PICKLE_OPCODE.STOP: {
        if (protocol !== 2) {
          parserError('PICKLE_PROTOCOL_NOT_SUPPORTED', 'Pickle protocol 2 header is required', opcodeOffset);
        }
        const result = pop(opcodeOffset);
        if (offset !== bytes.length) {
          parserError('PICKLE_TRAILING_DATA', 'Trailing data after Pickle STOP', offset);
        }
        if (stack.length !== 0) {
          parserError('PICKLE_STACK_NOT_EMPTY', 'Pickle stack is not empty after STOP', opcodeOffset);
        }
        return result;
      }
      default:
        parserError(
          'PICKLE_OPCODE_NOT_SUPPORTED',
          `Pickle opcode ${PICKLE_OPCODE_NAME[opcode] ?? `0x${opcode.toString(16)}`} is not supported`,
          opcodeOffset,
        );
    }
  }

  parserError('PICKLE_STOP_MISSING', 'Pickle payload has no STOP opcode', offset);
}
