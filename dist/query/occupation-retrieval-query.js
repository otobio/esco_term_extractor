import { timed } from '../utils/timing.js';
import { cleanOccupationTitleSignals } from './occupation-signal-oov-cleaner.js';
import { selectOccupationRoleSpan } from './occupation-role-span-selector.js';
import { prepareQuery } from './query-preparation.js';
export async function prepareOccupationRetrievalQuery(options) {
    const timings = options.timings ?? {};
    const signalCleaning = await timed(() => cleanOccupationTitleSignals({
        sourceName: options.sourceName,
        locale: options.locale,
        title: options.originalQuery
    }), 'candidate.query_signal_cleaning', timings);
    const querySignalCleaningMs = timings['candidate.query_signal_cleaning'] ?? 0;
    const querySpans = signalCleaning.keptSignals.length > 0 ? signalCleaning.keptSignals : [options.originalQuery];
    const roleSpanSelection = await timed(() => selectOccupationRoleSpan({
        sourceName: options.sourceName,
        locale: options.locale,
        originalQuery: options.originalQuery,
        querySpans
    }), 'candidate.role_span_selection', timings);
    const query = roleSpanSelection.roleQuery.trim() || querySpans.join(' ').trim() || options.originalQuery;
    const preparedQuery = await prepareQuery(query, options.locale, { sourceName: options.sourceName });
    return {
        originalQuery: options.originalQuery,
        query,
        querySpans,
        locale: options.locale,
        normalizedQuery: preparedQuery.normalized,
        foldedQuery: preparedQuery.folded,
        querySignals: signalCleaning.signals,
        keptQuerySignals: signalCleaning.keptSignals,
        querySignalCleaningMs,
        roleSpanSelection,
        preparedQuery
    };
}
