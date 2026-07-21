import { OpenSearchAliasRetriever } from './opensearch-alias-retriever.js';
import { OpenSearchOccupationRetriever } from './opensearch-occupation-retriever.js';
import type { OccupationRetrievalEngine } from './retrieval-engine.js';

export function createOpenSearchRetrievalEngine(): OccupationRetrievalEngine {
  return {
    aliases: new OpenSearchAliasRetriever(),
    occupations: new OpenSearchOccupationRetriever()
  };
}
