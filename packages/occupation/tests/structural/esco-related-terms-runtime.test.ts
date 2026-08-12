import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { giveObjectRelated, giveVerbSynonym } from '../../src/api/esco-related-terms.js';
import { buildEscoRelatedTermsBinaryFiles, type EscoRelatedTermsBinaryBuildInput } from '../../src/runtime/esco-related-terms-artifact.js';

const SOURCE_NAME = 'esco_1_2_1';
const LOCALE = 'en';

test('ESCO related-term runtime API resolves from the binary artifact', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'esco-related-terms-'));
  const manifestPath = path.join(tempDir, `esco-related-terms.${SOURCE_NAME}.${LOCALE}.binary.manifest.json`);
  const prefix = path.join(tempDir, `esco-related-terms.${SOURCE_NAME}.${LOCALE}.binary`);
  const previousArtifactPath = process.env.OCCUPATION_ESCO_RELATED_TERMS_ARTIFACT_PATH;

  try {
    const input: EscoRelatedTermsBinaryBuildInput = {
      sourceName: SOURCE_NAME,
      locale: LOCALE,
      buildRunId: 1,
      verbRows: [
        {
          sourceTerm: 'monitor',
          relatedTerm: 'oversee',
          relationshipType: 'same_skill',
          direction: 'forward',
          evidenceCount: 3,
          sourceLabelExamples: ['monitor systems'],
          relatedLabelExamples: ['oversee systems']
        },
        {
          sourceTerm: 'oversee',
          relatedTerm: 'monitor',
          relationshipType: 'same_skill',
          direction: 'reverse',
          evidenceCount: 3,
          sourceLabelExamples: ['oversee systems'],
          relatedLabelExamples: ['monitor systems']
        }
      ],
      objectRows: [
        {
          sourceTerm: 'employee',
          relatedTerm: 'staff',
          relationshipType: 'same_skill',
          direction: 'forward',
          evidenceCount: 2,
          sourceLabelExamples: ['monitor employee'],
          relatedLabelExamples: ['monitor staff']
        },
        {
          sourceTerm: 'staff',
          relatedTerm: 'employee',
          relationshipType: 'same_skill',
          direction: 'reverse',
          evidenceCount: 2,
          sourceLabelExamples: ['monitor staff'],
          relatedLabelExamples: ['monitor employee']
        }
      ]
    };

    const binary = buildEscoRelatedTermsBinaryFiles(input, prefix);
    const manifest = {
      schemaVersion: 2 as const,
      sourceName: SOURCE_NAME,
      locale: LOCALE,
      buildRunId: 1,
      generatedAt: new Date().toISOString(),
      stringCount: binary.stringCount,
      verbRowCount: binary.verbRowCount,
      verbSourceKeyCount: binary.verbSourceKeyCount,
      verbRelatedKeyCount: binary.verbRelatedKeyCount,
      objectRowCount: binary.objectRowCount,
      objectSourceKeyCount: binary.objectSourceKeyCount,
      objectRelatedKeyCount: binary.objectRelatedKeyCount,
      files: binary.manifestFiles
    };

    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await Promise.all([...binary.buffers.entries()].map(([filePath, buffer]) => writeFile(filePath, buffer)));

    process.env.OCCUPATION_ESCO_RELATED_TERMS_ARTIFACT_PATH = manifestPath;

    const verbRows = await giveVerbSynonym('monitor', { sourceName: SOURCE_NAME, locale: LOCALE, limit: 10 });
    const objectRows = await giveObjectRelated('employee', { sourceName: SOURCE_NAME, locale: LOCALE, limit: 10 });

    assert.equal(verbRows.length, 1);
    assert.equal(verbRows[0]?.relatedVerb, 'oversee');
    assert.equal(verbRows[0]?.direction, 'forward');
    assert.equal(verbRows[0]?.evidenceCount, 3);

    assert.equal(objectRows.length, 1);
    assert.equal(objectRows[0]?.relatedObject, 'staff');
    assert.equal(objectRows[0]?.direction, 'forward');
    assert.equal(objectRows[0]?.evidenceCount, 2);
  } finally {
    if (previousArtifactPath === undefined) {
      delete process.env.OCCUPATION_ESCO_RELATED_TERMS_ARTIFACT_PATH;
    } else {
      process.env.OCCUPATION_ESCO_RELATED_TERMS_ARTIFACT_PATH = previousArtifactPath;
    }

    await rm(tempDir, { recursive: true, force: true });
  }
});
