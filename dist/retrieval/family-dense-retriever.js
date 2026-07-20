import { loadOccupationVectorArtifactRequired, scoreOccupationVectorRecords } from '../runtime/occupation-vector-artifact.js';
import { embedRuntimeQuery } from '../runtime/query-embedding.js';
import { timed } from '../utils/timing.js';
import { isDenseRetrievalDisabled } from './occupation-candidates.js';
export class FamilyDenseRetriever {
    async retrieve(options) {
        if (options.familyNodeIds.length === 0 || isDenseRetrievalDisabled()) {
            return [];
        }
        const timings = options.timings ?? {};
        const artifactEntry = await timed(() => loadOccupationVectorArtifactRequired(options.sourceName, options.modelKey), 'family_dense.vector_artifact_load', timings);
        const queryEmbedding = await embedRuntimeQuery(options.query, {
            model_key: artifactEntry.artifact.modelKey,
            provider: artifactEntry.artifact.provider,
            dimensions: artifactEntry.artifact.dimensions
        }, timings, 'family_dense.embedding_provider');
        const familyRecords = await timed(() => familyVectorRecords(artifactEntry.vectorsByFamilyNodeId, options.familyNodeIds), 'family_dense.select_family_vectors', timings);
        return timed(() => scoreOccupationVectorRecords(familyRecords, artifactEntry.artifact.vectorValues, artifactEntry.artifact.dimensions, queryEmbedding.vector, queryEmbedding.vectorNorm, { limit: options.limit }), 'family_dense.scoring', timings);
    }
}
function familyVectorRecords(vectorsByFamilyNodeId, familyNodeIds) {
    const records = [];
    for (const familyNodeId of familyNodeIds) {
        records.push(...(vectorsByFamilyNodeId.get(familyNodeId) ?? []));
    }
    return records;
}
