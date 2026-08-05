import { DomainValidationError } from '../../domain/validation.js';

const CONFIG_TYPE = 'lauraycs-simulation-node-config';
const SUPPORTED_VERSION = 1;

const ROLE_BY_NODE_GROUP = {
  baseStation: 'transmitter-config',
  terminal: 'receiver-config',
};

export function classifyLauraycsConfig(config) {
  if (config?.type !== CONFIG_TYPE) {
    throw new DomainValidationError(
      'CONFIG_TYPE_NOT_SUPPORTED',
      `Expected Lauraycs config type ${CONFIG_TYPE}`,
    );
  }
  if (config.version !== SUPPORTED_VERSION) {
    throw new DomainValidationError(
      'CONFIG_VERSION_NOT_SUPPORTED',
      `Unsupported Lauraycs config version ${config.version}`,
    );
  }
  const role = ROLE_BY_NODE_GROUP[config.nodeGroup];
  if (!role) {
    throw new DomainValidationError(
      'CONFIG_NODE_GROUP_NOT_SUPPORTED',
      `Unsupported Lauraycs nodeGroup ${config.nodeGroup}`,
    );
  }
  return { role, config };
}

export function classifyLauraycsConfigFile({ text }) {
  let config;
  try {
    config = JSON.parse(text);
  } catch (error) {
    throw new DomainValidationError(
      'CONFIG_JSON_INVALID',
      `Invalid Lauraycs JSON: ${error.message}`,
    );
  }
  return classifyLauraycsConfig(config);
}
