import {
  hashVocabularyText,
  loadOccupationSignalVocabularyArtifactRequired,
  type OccupationSignalVocabularyArtifact
} from '../runtime/occupation-signal-vocabulary-artifact.js';
import { foldSearchText, tokenizeNormalizedText } from '../query/query-preparation.js';

const SIGNAL_VOCABULARY_ARTIFACT_CACHE = new Map<string, Promise<OccupationSignalVocabularyArtifact>>();

async function loadSignalVocabularyArtifact(sourceName: string): Promise<OccupationSignalVocabularyArtifact> {
  const cachedArtifact = SIGNAL_VOCABULARY_ARTIFACT_CACHE.get(sourceName);

  if (cachedArtifact) {
    return cachedArtifact;
  }

  const artifactPromise = loadOccupationSignalVocabularyArtifactRequired(sourceName).then((entry) => entry.artifact);
  SIGNAL_VOCABULARY_ARTIFACT_CACHE.set(sourceName, artifactPromise);
  return artifactPromise;
}

export async function isEnglishWord(value: string, sourceName: string): Promise<boolean> {
  const artifact = await loadSignalVocabularyArtifact(sourceName);
  const tokens = tokenizeNormalizedText(foldSearchText(value));

  if (tokens.length !== 1) {
    return false;
  }

  const token = tokens[0];

  if (!token) {
    return false;
  }

  const tokenIndex = artifact.tokenHashes.indexOf(hashVocabularyText(token));
  return tokenIndex >= 0 && artifact.englishTokenBits.has(tokenIndex);
}

export async function isEnglishQuery(value: string, sourceName: string): Promise<boolean> {
  const artifact = await loadSignalVocabularyArtifact(sourceName);
  const tokens = tokenizeNormalizedText(foldSearchText(value));

  if (tokens.length === 0) {
    return false;
  }

  for (const token of tokens) {
    const tokenIndex = artifact.tokenHashes.indexOf(hashVocabularyText(token));

    if (tokenIndex < 0 || !artifact.englishTokenBits.has(tokenIndex)) {
      return false;
    }
  }

  return true;
}
