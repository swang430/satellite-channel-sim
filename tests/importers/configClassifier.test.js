import { describe, expect, it } from 'vitest';
import { classifyLauraycsConfigFile } from '../../src/importers/mpdb/configClassifier.js';
import { buildLauraycsConfigFixtures } from '../fixtures/lauraycsConfigs.js';

describe('Lauraycs config content classifier', () => {
  it('classifies arbitrary filenames using JSON content only', () => {
    const { transmitterConfig, receiverConfig } = buildLauraycsConfigFixtures();

    expect(classifyLauraycsConfigFile({
      name: 'anything.json',
      text: JSON.stringify(receiverConfig),
    }).role).toBe('receiver-config');
    expect(classifyLauraycsConfigFile({
      name: 'renamed-without-role.json',
      text: JSON.stringify(transmitterConfig),
    }).role).toBe('transmitter-config');
  });

  it.each([
    [{ type: 'other', version: 1, nodeGroup: 'terminal' }, 'CONFIG_TYPE_NOT_SUPPORTED'],
    [{ type: 'lauraycs-simulation-node-config', version: 2, nodeGroup: 'terminal' }, 'CONFIG_VERSION_NOT_SUPPORTED'],
    [{ type: 'lauraycs-simulation-node-config', version: 1, nodeGroup: 'unknown' }, 'CONFIG_NODE_GROUP_NOT_SUPPORTED'],
  ])('rejects unsupported content', (config, code) => {
    expect(() => classifyLauraycsConfigFile({
      name: 'looks-valid.json',
      text: JSON.stringify(config),
    })).toThrowError(expect.objectContaining({ code }));
  });
});
