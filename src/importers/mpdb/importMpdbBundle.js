import { DomainValidationError } from '../../domain/validation.js';
import { adaptLauraycsConfigs } from './lauraycsConfigAdapter.js';
import { detectMpdbBundleFile } from './fileContentDetector.js';
import { readMpdbColumns } from './mpdbColumnReader.js';
import { assembleMpdbScenario } from './scenarioAssembler.js';
import { readTorchArchive } from './torchArchiveReader.js';

function toHex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function sha256(data) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return toHex(new Uint8Array(digest));
}

function assertRequiredRoles(detectedFiles) {
  const byRole = new Map();
  for (const file of detectedFiles) {
    if (byRole.has(file.role)) {
      throw new DomainValidationError(
        'IMPORT_FILE_ROLE_DUPLICATED',
        `Multiple files contain the ${file.role} role`,
      );
    }
    byRole.set(file.role, file);
  }
  for (const role of ['mpdb', 'transmitter-config', 'receiver-config']) {
    if (!byRole.has(role)) {
      throw new DomainValidationError(
        'IMPORT_FILE_ROLE_MISSING',
        `Import bundle is missing ${role}`,
      );
    }
  }
  return byRole;
}

async function describeSourceFiles(detectedFiles) {
  return Promise.all(detectedFiles.map(async (file) => ({
    role: file.role,
    originalName: file.originalName,
    sha256: await sha256(file.data),
    byteLength: file.data.byteLength,
  })));
}

async function scenarioIdFromSources(sourceFiles) {
  const canonical = [...sourceFiles]
    .sort((left, right) => left.role.localeCompare(right.role))
    .map(({ role, sha256: hash }) => `${role}:${hash}`)
    .join('\n');
  return `sha256:${await sha256(new TextEncoder().encode(canonical))}`;
}

export async function importMpdbBundle(files, options = {}) {
  if (!Array.isArray(files)) {
    throw new DomainValidationError('IMPORT_FILES_INVALID', 'Import files must be an array');
  }
  const detectedFiles = await Promise.all(
    files.map((file) => detectMpdbBundleFile(file, options.detectionLimits)),
  );
  const byRole = assertRequiredRoles(detectedFiles);
  const sourceFiles = await describeSourceFiles(detectedFiles);
  const scenarioId = await scenarioIdFromSources(sourceFiles);
  const config = adaptLauraycsConfigs([
    byRole.get('transmitter-config').config,
    byRole.get('receiver-config').config,
  ]);
  const archive = await readTorchArchive(
    byRole.get('mpdb').torchArchiveBytes,
    options.mpdbLimits,
  );
  const mpdb = await readMpdbColumns(archive);
  return assembleMpdbScenario({
    config,
    mpdb,
    sourceFiles,
    scenarioId,
    alignmentTolerance_m: options.alignmentTolerance_m,
  });
}
