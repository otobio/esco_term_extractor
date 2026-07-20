import {
  loadOccupationVectorArtifactRequired,
  scoreOccupationVectorRecords,
  type OccupationVectorRecord
} from '../runtime/occupation-vector-artifact.js';
import { embedRuntimeQuery, type QueryEmbeddingRuntimeModel } from '../runtime/query-embedding.js';
import { timed, type TimingMap } from '../utils/timing.js';
import { isDenseRetrievalDisabled } from './occupation-candidates.js';

export type FamilyDenseRetrieverOptions = {
  query: string;
  sourceName: string;
  modelKey: string;
  familyNodeIds: number[];
  limit: number;
  timings?: TimingMap;
};

export type FamilyDenseHit = {
  graphNodeId: number;
  canonicalLabel: string;
  familyNodeId: number;
  familyLabel: string;
  score: number;
  dot: number;
};

type EmbeddingRuntimeModel = QueryEmbeddingRuntimeModel;

export class FamilyDenseRetriever {
  public async retrieve(options: FamilyDenseRetrieverOptions): Promise<FamilyDenseHit[]> {
    if (options.familyNodeIds.length === 0 || isDenseRetrievalDisabled()) {
      return [];
    }

    const timings = options.timings ?? {};
    const artifactEntry = await timed(
      () => loadOccupationVectorArtifactRequired(options.sourceName, options.modelKey),
      'family_dense.vector_artifact_load',
      timings
    );
    const queryEmbedding = await embedRuntimeQuery(options.query, {
      model_key: artifactEntry.artifact.modelKey,
      provider: artifactEntry.artifact.provider,
      dimensions: artifactEntry.artifact.dimensions
    }, timings, 'family_dense.embedding_provider');
    const familyRecords = await timed(
      () => familyVectorRecords(artifactEntry.vectorsByFamilyNodeId, options.familyNodeIds),
      'family_dense.select_family_vectors',
      timings
    );

    return timed(
      () => scoreOccupationVectorRecords(
        familyRecords,
        artifactEntry.artifact.vectorValues,
        artifactEntry.artifact.dimensions,
        queryEmbedding.vector,
        queryEmbedding.vectorNorm,
        { limit: options.limit }
      ),
      'family_dense.scoring',
      timings
    );
  }
}

function familyVectorRecords(
  vectorsByFamilyNodeId: Map<number, OccupationVectorRecord[]>,
  familyNodeIds: number[]
): OccupationVectorRecord[] {
  const records: OccupationVectorRecord[] = [];

  for (const familyNodeId of familyNodeIds) {
    records.push(...(vectorsByFamilyNodeId.get(familyNodeId) ?? []));
  }

  return records;
}
