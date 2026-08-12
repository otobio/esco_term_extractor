import { OpenSearchAliasRetriever } from './opensearch-alias-retriever.js';
import { OpenSearchOccupationRetriever } from './opensearch-occupation-retriever.js';
export function createOpenSearchRetrievalEngine() {
    return {
        aliases: new OpenSearchAliasRetriever(),
        occupations: new OpenSearchOccupationRetriever()
    };
}
