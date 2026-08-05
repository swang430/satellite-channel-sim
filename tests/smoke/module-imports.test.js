import { describe, expect, it } from 'vitest';
import { computeCIR } from '../../src/model.js';
import { predictLinkStateNow } from '../../src/oracleCore.js';
import { linkStateToNTNParams } from '../../src/adapters/ntnAdapter.js';
import { selectMODCOD } from '../../src/adapters/dvbS2xAdapter.js';

describe('module smoke imports', () => {
  it('exposes the supported public entry points', () => {
    expect(computeCIR).toBeTypeOf('function');
    expect(predictLinkStateNow).toBeTypeOf('function');
    expect(linkStateToNTNParams).toBeTypeOf('function');
    expect(selectMODCOD).toBeTypeOf('function');
  });
});
