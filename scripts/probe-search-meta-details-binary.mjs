#!/usr/bin/env node

import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const DEFAULT_RUNTIME_DIR = 'artifacts/runtime';
const DEFAULT_SOURCE_NAME = 'esco_1_2_1';
const DEFAULT_OUTPUT_DIR = '/tmp/ose-search-meta-details-binary-test';
const SAME_STRING_ID = 0xffffffff;

const LOCALE_CODES = ['en', 'et', 'hu', 'ro'];
const ALIAS_ROLES = [
  'locale_primary',
  'locale_supporting',
  'family_supporting',
  'english_backbone',
  'reviewed_crosswalk'
];
const CAPABILITY_TYPES = ['skill', 'knowledge', 'tool', 'software', 'language'];
const HINT_KINDS = ['essential', 'optional'];
const SCORE_VALUES = [null, 0.6, 0.65, 0.7, 0.72, 0.75, 0.8, 0.82, 0.85, 0.9, 0.9111, 0.9167, 0.9429, 0.95, 1];

function main() {
  const args = parseArgs(process.argv.slice(2));
  const runtimeDir = args.runtimeDir ?? DEFAULT_RUNTIME_DIR;
  const sourceName = args.sourceName ?? DEFAULT_SOURCE_NAME;
  const outputDir = args.outputDir ?? DEFAULT_OUTPUT_DIR;
  const clean = args.clean !== false;

  const inputPaths = findInputPaths(runtimeDir, sourceName, args.shard);

  if (inputPaths.length === 0) {
    throw new Error(`No details shards found for source=${sourceName} under ${runtimeDir}.`);
  }

  if (clean) {
    rmSync(outputDir, { recursive: true, force: true });
  }
  mkdirSync(outputDir, { recursive: true });

  const start = performance.now();
  const loaded = loadRecords(inputPaths);
  const loadMs = performance.now() - start;

  const encodeStart = performance.now();
  const encoded = encodeArtifact(loaded.records);
  writeArtifact(outputDir, encoded, {
    sourceName,
    inputPaths,
    rawBytes: loaded.rawBytes,
    records: loaded.records.length
  });
  const encodeMs = performance.now() - encodeStart;

  const decodeStart = performance.now();
  const decoded = decodeArtifact(outputDir);
  const decodeMs = performance.now() - decodeStart;

  const parityStart = performance.now();
  const parity = checkParity(loaded.records, decoded.records);
  const parityMs = performance.now() - parityStart;

  const outputFiles = [
    'details.strings.bin',
    'details.strings.idx',
    'details.records.bin',
    'details.records.idx',
    'details.manifest.json'
  ].map((fileName) => ({
    fileName,
    bytes: statSync(path.join(outputDir, fileName)).size
  }));

  const outputBytes = outputFiles.reduce((sum, file) => sum + file.bytes, 0);

  const summary = {
    input: {
      files: inputPaths.length,
      rawBytes: loaded.rawBytes,
      rawMiB: toMiB(loaded.rawBytes),
      records: loaded.records.length,
      aliases: loaded.aliasCount,
      capabilityLabels: loaded.capabilityCount
    },
    output: {
      dir: outputDir,
      bytes: outputBytes,
      miB: toMiB(outputBytes),
      ratio: Number((outputBytes / loaded.rawBytes).toFixed(4)),
      largestFileMiB: toMiB(Math.max(...outputFiles.map((file) => file.bytes))),
      files: outputFiles.map((file) => ({
        ...file,
        miB: toMiB(file.bytes)
      }))
    },
    dictionary: {
      strings: encoded.stringCount,
      stringPayloadBytes: encoded.stringPayloadBytes,
      stringPayloadMiB: toMiB(encoded.stringPayloadBytes)
    },
    timingsMs: {
      loadJson: Math.round(loadMs),
      encodeAndWrite: Math.round(encodeMs),
      decodeAll: Math.round(decodeMs),
      parity: Math.round(parityMs)
    },
    parity
  };

  console.log(JSON.stringify(summary, null, 2));
}

function parseArgs(rawArgs) {
  const parsed = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === '--runtime-dir') {
      parsed.runtimeDir = requireValue(rawArgs, ++index, arg);
    } else if (arg === '--source-name') {
      parsed.sourceName = requireValue(rawArgs, ++index, arg);
    } else if (arg === '--output-dir') {
      parsed.outputDir = requireValue(rawArgs, ++index, arg);
    } else if (arg === '--shard') {
      parsed.shard = requireValue(rawArgs, ++index, arg);
    } else if (arg === '--no-clean') {
      parsed.clean = false;
    } else if (arg === '--help' || arg === '-h') {
      printHelpAndExit();
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function requireValue(rawArgs, index, argName) {
  const value = rawArgs[index];

  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${argName}.`);
  }

  return value;
}

function printHelpAndExit() {
  console.log([
    'Usage: node scripts/probe-search-meta-details-binary.mjs [options]',
    '',
    'Options:',
    `  --runtime-dir <path>   Runtime artifact directory. Default: ${DEFAULT_RUNTIME_DIR}`,
    `  --source-name <name>   Source name. Default: ${DEFAULT_SOURCE_NAME}`,
    `  --output-dir <path>    Output directory. Default: ${DEFAULT_OUTPUT_DIR}`,
    '  --shard <nnn>          Encode only one details shard, such as 000.',
    '  --no-clean            Keep existing output directory contents.'
  ].join('\n'));
  process.exit(0);
}

function findInputPaths(runtimeDir, sourceName, shard) {
  const prefix = `occupation-search-meta.${sourceName}.details.`;
  const suffix = '.jsonl';

  if (shard) {
    return [path.join(runtimeDir, `${prefix}${shard}${suffix}`)];
  }

  return readdirSync(runtimeDir)
    .filter((fileName) => fileName.startsWith(prefix) && fileName.endsWith(suffix))
    .sort()
    .map((fileName) => path.join(runtimeDir, fileName));
}

function loadRecords(inputPaths) {
  const records = [];
  let rawBytes = 0;
  let aliasCount = 0;
  let capabilityCount = 0;

  for (const inputPath of inputPaths) {
    const raw = readFileSync(inputPath);
    rawBytes += raw.length;

    const lines = raw.toString('utf8').split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed) {
        continue;
      }

      const parsed = JSON.parse(trimmed);
      validateRecord(parsed, inputPath);
      records.push(parsed);
      aliasCount += parsed.aliases.length;
      capabilityCount += parsed.capabilityLabels.length;
    }
  }

  return {
    records,
    rawBytes,
    aliasCount,
    capabilityCount
  };
}

function encodeArtifact(records) {
  const dictionary = new StringDictionary();
  const recordBuffers = [];
  const indexBuffer = Buffer.allocUnsafe(records.length * 20);
  let recordsOffset = 0;

  records.forEach((record, index) => {
    const recordBuffer = encodeRecord(record, dictionary);
    recordBuffer.copy(indexBuffer, index * 20);
    indexBuffer.writeUInt32LE(record.graphNodeId, index * 20);
    indexBuffer.writeBigUInt64LE(BigInt(recordsOffset), index * 20 + 4);
    indexBuffer.writeUInt32LE(recordBuffer.length, index * 20 + 12);
    indexBuffer.writeUInt32LE(index, index * 20 + 16);
    recordBuffers.push(recordBuffer);
    recordsOffset += recordBuffer.length;
  });

  const { stringsBuffer, stringsIndexBuffer, stringPayloadBytes } = dictionary.toBuffers();

  return {
    recordsBuffer: Buffer.concat(recordBuffers),
    recordsIndexBuffer: indexBuffer,
    stringsBuffer,
    stringsIndexBuffer,
    stringCount: dictionary.size,
    stringPayloadBytes
  };
}

function encodeRecord(record, dictionary) {
  const headerBytes = 12;
  const aliasRowBytes = 16;
  const capabilityRowBytes = 16;
  const buffer = Buffer.allocUnsafe(
    headerBytes +
      record.aliases.length * aliasRowBytes +
      record.capabilityLabels.length * capabilityRowBytes
  );
  let offset = 0;

  buffer.writeUInt32LE(record.graphNodeId, offset);
  offset += 4;
  buffer.writeUInt32LE(record.aliases.length, offset);
  offset += 4;
  buffer.writeUInt32LE(record.capabilityLabels.length, offset);
  offset += 4;

  for (const alias of record.aliases) {
    const aliasId = dictionary.idFor(alias.alias);
    const normalizedAliasId = alias.alias === alias.normalizedAlias
      ? SAME_STRING_ID
      : dictionary.idFor(alias.normalizedAlias);

    buffer.writeUInt32LE(aliasId, offset);
    buffer.writeUInt32LE(normalizedAliasId, offset + 4);
    buffer.writeUInt8(enumCode(LOCALE_CODES, alias.localeCode, 'localeCode'), offset + 8);
    buffer.writeUInt8(enumCode(ALIAS_ROLES, alias.aliasRole, 'aliasRole'), offset + 9);
    buffer.writeUInt8(alias.isPrimary ? 1 : 0, offset + 10);
    buffer.writeUInt8(scoreCode(alias.confidence), offset + 11);
    buffer.writeUInt8(scoreCode(alias.weight), offset + 12);
    buffer.fill(0, offset + 13, offset + 16);
    offset += aliasRowBytes;
  }

  for (const capability of record.capabilityLabels) {
    const labelId = dictionary.idFor(capability.label);
    const normalizedLabelId = capability.label === capability.normalizedLabel
      ? SAME_STRING_ID
      : dictionary.idFor(capability.normalizedLabel);

    buffer.writeUInt32LE(capability.capabilityId, offset);
    buffer.writeUInt32LE(labelId, offset + 4);
    buffer.writeUInt32LE(normalizedLabelId, offset + 8);
    buffer.writeUInt8(enumCode(CAPABILITY_TYPES, capability.capabilityType, 'capabilityType'), offset + 12);
    buffer.writeUInt8(enumCode(HINT_KINDS, capability.hintKind, 'hintKind'), offset + 13);
    buffer.writeUInt8(scoreCode(capability.weight), offset + 14);
    buffer.writeUInt8(0, offset + 15);
    offset += capabilityRowBytes;
  }

  return buffer;
}

function writeArtifact(outputDir, encoded, metadata) {
  writeFileSync(path.join(outputDir, 'details.strings.bin'), encoded.stringsBuffer);
  writeFileSync(path.join(outputDir, 'details.strings.idx'), encoded.stringsIndexBuffer);
  writeFileSync(path.join(outputDir, 'details.records.bin'), encoded.recordsBuffer);
  writeFileSync(path.join(outputDir, 'details.records.idx'), encoded.recordsIndexBuffer);
  writeFileSync(
    path.join(outputDir, 'details.manifest.json'),
    JSON.stringify({
      schemaVersion: 0,
      format: 'occupation-search-meta-details-dictionary-probe',
      compression: 'none',
      generatedAt: new Date().toISOString(),
      sourceName: metadata.sourceName,
      inputPaths: metadata.inputPaths,
      rawBytes: metadata.rawBytes,
      records: metadata.records,
      enums: {
        localeCodes: LOCALE_CODES,
        aliasRoles: ALIAS_ROLES,
        capabilityTypes: CAPABILITY_TYPES,
        hintKinds: HINT_KINDS,
        scoreValues: SCORE_VALUES
      },
      files: {
        strings: 'details.strings.bin',
        stringsIndex: 'details.strings.idx',
        records: 'details.records.bin',
        recordsIndex: 'details.records.idx'
      }
    }, null, 2)
  );
}

function decodeArtifact(outputDir) {
  const manifest = JSON.parse(readFileSync(path.join(outputDir, 'details.manifest.json'), 'utf8'));
  const stringsBuffer = readFileSync(path.join(outputDir, manifest.files.strings));
  const stringsIndexBuffer = readFileSync(path.join(outputDir, manifest.files.stringsIndex));
  const recordsBuffer = readFileSync(path.join(outputDir, manifest.files.records));
  const recordsIndexBuffer = readFileSync(path.join(outputDir, manifest.files.recordsIndex));
  const dictionary = decodeStrings(stringsBuffer, stringsIndexBuffer);
  const records = [];

  for (let offset = 0; offset < recordsIndexBuffer.length; offset += 20) {
    const recordOffset = Number(recordsIndexBuffer.readBigUInt64LE(offset + 4));
    const byteLength = recordsIndexBuffer.readUInt32LE(offset + 12);
    records.push(decodeRecord(recordsBuffer.subarray(recordOffset, recordOffset + byteLength), dictionary));
  }

  return { records };
}

function decodeStrings(stringsBuffer, stringsIndexBuffer) {
  const strings = [];

  for (let offset = 0; offset < stringsIndexBuffer.length; offset += 12) {
    const stringOffset = Number(stringsIndexBuffer.readBigUInt64LE(offset));
    const byteLength = stringsIndexBuffer.readUInt32LE(offset + 8);
    strings.push(stringsBuffer.toString('utf8', stringOffset, stringOffset + byteLength));
  }

  return strings;
}

function decodeRecord(buffer, dictionary) {
  let offset = 0;
  const graphNodeId = buffer.readUInt32LE(offset);
  offset += 4;
  const aliasCount = buffer.readUInt32LE(offset);
  offset += 4;
  const capabilityCount = buffer.readUInt32LE(offset);
  offset += 4;

  const aliases = [];

  for (let index = 0; index < aliasCount; index += 1) {
    const aliasId = buffer.readUInt32LE(offset);
    const normalizedAliasId = buffer.readUInt32LE(offset + 4);
    const alias = dictionary[aliasId];
    aliases.push({
      localeCode: LOCALE_CODES[buffer.readUInt8(offset + 8)],
      alias,
      normalizedAlias: normalizedAliasId === SAME_STRING_ID ? alias : dictionary[normalizedAliasId],
      aliasRole: ALIAS_ROLES[buffer.readUInt8(offset + 9)],
      isPrimary: buffer.readUInt8(offset + 10) === 1,
      confidence: SCORE_VALUES[buffer.readUInt8(offset + 11)],
      weight: SCORE_VALUES[buffer.readUInt8(offset + 12)]
    });
    offset += 16;
  }

  const capabilityLabels = [];

  for (let index = 0; index < capabilityCount; index += 1) {
    const capabilityId = buffer.readUInt32LE(offset);
    const labelId = buffer.readUInt32LE(offset + 4);
    const normalizedLabelId = buffer.readUInt32LE(offset + 8);
    const label = dictionary[labelId];
    capabilityLabels.push({
      capabilityId,
      capabilityType: CAPABILITY_TYPES[buffer.readUInt8(offset + 12)],
      label,
      normalizedLabel: normalizedLabelId === SAME_STRING_ID ? label : dictionary[normalizedLabelId],
      hintKind: HINT_KINDS[buffer.readUInt8(offset + 13)],
      weight: SCORE_VALUES[buffer.readUInt8(offset + 14)]
    });
    offset += 16;
  }

  return {
    graphNodeId,
    aliases,
    capabilityLabels
  };
}

function checkParity(originalRecords, decodedRecords) {
  if (originalRecords.length !== decodedRecords.length) {
    return {
      ok: false,
      reason: `record count mismatch original=${originalRecords.length} decoded=${decodedRecords.length}`
    };
  }

  for (let index = 0; index < originalRecords.length; index += 1) {
    const original = originalRecords[index];
    const decoded = decodedRecords[index];
    const mismatch = compareRecord(original, decoded);

    if (mismatch) {
      return {
        ok: false,
        recordIndex: index,
        graphNodeId: original.graphNodeId,
        reason: mismatch
      };
    }
  }

  return { ok: true };
}

function compareRecord(original, decoded) {
  if (original.graphNodeId !== decoded.graphNodeId) {
    return `graphNodeId mismatch original=${original.graphNodeId} decoded=${decoded.graphNodeId}`;
  }

  if (original.aliases.length !== decoded.aliases.length) {
    return `alias count mismatch original=${original.aliases.length} decoded=${decoded.aliases.length}`;
  }

  if (original.capabilityLabels.length !== decoded.capabilityLabels.length) {
    return `capability count mismatch original=${original.capabilityLabels.length} decoded=${decoded.capabilityLabels.length}`;
  }

  for (let index = 0; index < original.aliases.length; index += 1) {
    const left = original.aliases[index];
    const right = decoded.aliases[index];
    const fields = ['localeCode', 'alias', 'normalizedAlias', 'aliasRole', 'isPrimary', 'confidence', 'weight'];
    const mismatch = compareFields(left, right, fields);

    if (mismatch) {
      return `alias[${index}].${mismatch}`;
    }
  }

  for (let index = 0; index < original.capabilityLabels.length; index += 1) {
    const left = original.capabilityLabels[index];
    const right = decoded.capabilityLabels[index];
    const fields = ['capabilityId', 'capabilityType', 'label', 'normalizedLabel', 'hintKind', 'weight'];
    const mismatch = compareFields(left, right, fields);

    if (mismatch) {
      return `capabilityLabels[${index}].${mismatch}`;
    }
  }

  return null;
}

function compareFields(left, right, fields) {
  for (const field of fields) {
    if (left[field] !== right[field]) {
      return `${field} mismatch original=${String(left[field])} decoded=${String(right[field])}`;
    }
  }

  return null;
}

function validateRecord(record, inputPath) {
  if (
    !record ||
    !Number.isInteger(record.graphNodeId) ||
    !Array.isArray(record.aliases) ||
    !Array.isArray(record.capabilityLabels)
  ) {
    throw new Error(`Invalid details record in ${inputPath}.`);
  }
}

function enumCode(values, value, fieldName) {
  const index = values.indexOf(value);

  if (index < 0) {
    throw new Error(`Unknown ${fieldName}: ${value}`);
  }

  return index;
}

function scoreCode(value) {
  const index = SCORE_VALUES.indexOf(value);

  if (index < 0) {
    throw new Error(`Unknown score value: ${value}`);
  }

  return index;
}

function toMiB(bytes) {
  return Number((bytes / 1024 / 1024).toFixed(2));
}

class StringDictionary {
  ids = new Map();
  values = [];

  get size() {
    return this.values.length;
  }

  idFor(value) {
    const existing = this.ids.get(value);

    if (existing !== undefined) {
      return existing;
    }

    const id = this.values.length;
    this.ids.set(value, id);
    this.values.push(value);
    return id;
  }

  toBuffers() {
    const stringBuffers = [];
    const indexBuffer = Buffer.allocUnsafe(this.values.length * 12);
    let offset = 0;

    this.values.forEach((value, index) => {
      const stringBuffer = Buffer.from(value, 'utf8');
      indexBuffer.writeBigUInt64LE(BigInt(offset), index * 12);
      indexBuffer.writeUInt32LE(stringBuffer.length, index * 12 + 8);
      stringBuffers.push(stringBuffer);
      offset += stringBuffer.length;
    });

    return {
      stringsBuffer: Buffer.concat(stringBuffers),
      stringsIndexBuffer: indexBuffer,
      stringPayloadBytes: offset
    };
  }
}

main();
