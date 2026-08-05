import { describe, expect, it } from 'vitest';
import { readSafePickle } from '../../src/importers/mpdb/safePickleReader.js';
import {
  buildAllowedGlobalPickle,
  buildSimplePickle,
  buildUnknownGlobalPickle,
  pickle,
} from '../helpers/buildPickleFixture.js';

function expectCode(callback, code) {
  expect(callback).toThrowError(expect.objectContaining({ code }));
}

describe('safe Pickle Protocol 2 reader', () => {
  it('reads primitive containers without executing application code', () => {
    expect(readSafePickle(buildSimplePickle())).toEqual({
      answer: 42,
      items: [1, 2],
    });
  });

  it('reduces an allowlisted OrderedDict to a plain data object', () => {
    expect(readSafePickle(buildAllowedGlobalPickle())).toEqual({});
  });

  it('rejects globals outside the explicit allowlist', () => {
    expectCode(() => readSafePickle(buildUnknownGlobalPickle()), 'PICKLE_GLOBAL_NOT_ALLOWED');
  });

  it('rejects unknown opcodes with a byte offset', () => {
    try {
      readSafePickle(pickle.concat(pickle.proto2(), pickle.op(0xff)));
      throw new Error('expected parser failure');
    } catch (error) {
      expect(error).toMatchObject({ code: 'PICKLE_OPCODE_NOT_SUPPORTED', offset: 2 });
    }
  });

  it('rejects invalid memo references and stack underflow', () => {
    expectCode(
      () => readSafePickle(pickle.concat(pickle.proto2(), pickle.op(0x68, 7), pickle.op(0x2e))),
      'PICKLE_MEMO_REFERENCE_INVALID',
    );
    expectCode(
      () => readSafePickle(pickle.concat(pickle.proto2(), pickle.op(0x61), pickle.op(0x2e))),
      'PICKLE_STACK_UNDERFLOW',
    );
  });

  it('enforces operation, memo, container, and string limits', () => {
    expectCode(
      () => readSafePickle(buildSimplePickle(), { maxOperations: 2 }),
      'PICKLE_OPERATION_LIMIT',
    );
    expectCode(
      () => readSafePickle(
        pickle.concat(pickle.proto2(), pickle.op(0x4b, 1, 0x71, 1, 0x2e)),
        { maxMemoEntries: 1 },
      ),
      'PICKLE_MEMO_LIMIT',
    );
    expectCode(
      () => readSafePickle(buildSimplePickle(), { maxContainerLength: 1 }),
      'PICKLE_CONTAINER_LIMIT',
    );
    expectCode(
      () => readSafePickle(buildSimplePickle(), { maxStringLength: 3 }),
      'PICKLE_STRING_LIMIT',
    );
  });

  it('requires STOP to consume the complete payload', () => {
    const withTrailingByte = pickle.concat(buildSimplePickle(), pickle.op(0x4e));
    expectCode(() => readSafePickle(withTrailingByte), 'PICKLE_TRAILING_DATA');
  });
});
