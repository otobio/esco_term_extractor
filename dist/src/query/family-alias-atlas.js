import { foldSearchText, normalizeSearchSurfaceText } from '../utils/texts.js';
import { compareTokenPhraseWithOptionalLinkers } from './phrase-match.js';
import { reviewedFamilyAliasEntries } from './reviewed-query-prep-seeds.js';
const FAMILY_ALIAS_ENTRIES = [
    family('en', 'office administration', 'office administrator', 'office_administrator', 94),
    family('en', 'administrative support', 'administrative assistant', 'administrative_assistant', 94),
    family('en', 'data entry', 'data entry clerk', 'data_entry_clerk', 94),
    family('en', 'call center', 'call center representative', 'call_center_representative', 95),
    family('en', 'sales support', 'sales representative', 'sales_representative', 95),
    family('en', 'sales representative', 'sales representative', 'sales_representative', 95),
    family('en', 'retail assistant', 'retail assistant', 'retail_assistant', 95),
    family('en', 'warehouse operations', 'warehouse worker', 'warehouse_worker', 94),
    family('en', 'logistics clerk', 'logistics clerk', 'logistics_clerk', 94),
    family('en', 'production operations', 'production worker', 'production_worker', 94),
    family('en', 'maintenance technician', 'maintenance technician', 'maintenance_technician', 94),
    family('en', 'project management', 'project manager', 'project_manager', 95),
    family('en', 'store management', 'store manager', 'store_manager', 94),
    family('en', 'restaurant management', 'restaurant manager', 'restaurant_manager', 94),
    family('en', 'software development', 'software developer', 'software_developer', 95),
    family('en', 'network administration', 'network administrator', 'network_administrator', 94),
    family('en', 'accounting clerk', 'accounting clerk', 'accounting_clerk', 94),
    family('en', 'human resources', 'human resources assistant', 'human_resources_assistant', 94),
    family('en', 'delivery driver', 'delivery driver', 'delivery_driver', 94),
    family('en', 'truck driver', 'truck driver', 'truck_driver', 94),
    family('en', 'bus driver', 'bus driver', 'bus_driver', 94),
    family('en', 'cleaning and housekeeping', 'cleaner', 'cleaner', 94),
    family('en', 'security services', 'security guard', 'security_guard', 94),
    family('en', 'reception', 'receptionist', 'receptionist', 94),
    family('en', 'cash handling', 'cashier', 'cashier', 94),
    family('en', 'food service', 'waiter and bartender', 'waiter_bartender', 93),
    family('en', 'technical service', 'service technician', 'service_technician', 94),
    family('en', 'building maintenance', 'maintenance technician', 'maintenance_technician', 94),
    family('ro', 'administrare birou', 'office administrator', 'office_administrator', 95),
    family('ro', 'suport administrativ', 'administrative assistant', 'administrative_assistant', 95),
    family('ro', 'introducere date', 'data entry clerk', 'data_entry_clerk', 95),
    family('ro', 'call center', 'call center representative', 'call_center_representative', 95),
    family('ro', 'suport vanzari', 'sales representative', 'sales_representative', 95),
    family('ro', 'reprezentant vanzari', 'sales representative', 'sales_representative', 95),
    family('ro', 'asistent vanzari', 'sales assistant', 'sales_assistant', 95),
    family('ro', 'lucrator depozit', 'warehouse worker', 'warehouse_worker', 94),
    family('ro', 'lucrator logistica', 'logistics clerk', 'logistics_clerk', 94),
    family('ro', 'lucrator productie', 'production worker', 'production_worker', 94),
    family('ro', 'tehnician mentenanta', 'maintenance technician', 'maintenance_technician', 94),
    family('ro', 'management proiect', 'project manager', 'project_manager', 95),
    family('ro', 'management magazin', 'store manager', 'store_manager', 94),
    family('ro', 'management restaurant', 'restaurant manager', 'restaurant_manager', 94),
    family('ro', 'dezvoltare software', 'software developer', 'software_developer', 95),
    family('ro', 'administrare retea', 'network administrator', 'network_administrator', 94),
    family('ro', 'contabilitate', 'accounting clerk', 'accounting_clerk', 94),
    family('ro', 'resurse umane', 'human resources assistant', 'human_resources_assistant', 94),
    family('ro', 'livrare si distributie', 'delivery driver', 'delivery_driver', 94),
    family('ro', 'sofer camion', 'truck driver', 'truck_driver', 94),
    family('ro', 'sofer autobuz', 'bus driver', 'bus_driver', 94),
    family('ro', 'curatenie si mentenanta', 'cleaner', 'cleaner', 94),
    family('ro', 'servicii securitate', 'security guard', 'security_guard', 94),
    family('ro', 'receptie', 'receptionist', 'receptionist', 94),
    family('ro', 'casierie', 'cashier', 'cashier', 94),
    family('ro', 'servicii alimentare', 'waiter and bartender', 'waiter_bartender', 93),
    family('ro', 'tehnician service', 'service technician', 'service_technician', 94),
    family('ro', 'mentenanta cladiri', 'maintenance technician', 'maintenance_technician', 94),
    family('hu', 'irodai adminisztracio', 'office administrator', 'office_administrator', 95),
    family('hu', 'adminisztrativ tamogatas', 'administrative assistant', 'administrative_assistant', 95),
    family('hu', 'adatbeviteli munka', 'data entry clerk', 'data_entry_clerk', 95),
    family('hu', 'call center', 'call center representative', 'call_center_representative', 95),
    family('hu', 'ertekesitesi tamogatas', 'sales representative', 'sales_representative', 95),
    family('hu', 'ertekesitesi kepviselo', 'sales representative', 'sales_representative', 95),
    family('hu', 'bolti elado', 'sales assistant', 'sales_assistant', 95),
    family('hu', 'raktari munkatars', 'warehouse worker', 'warehouse_worker', 94),
    family('hu', 'logisztikai munkatars', 'logistics clerk', 'logistics_clerk', 94),
    family('hu', 'termelesi munkatars', 'production worker', 'production_worker', 94),
    family('hu', 'karbantarto technikus', 'maintenance technician', 'maintenance_technician', 94),
    family('hu', 'projektmenedzsment', 'project manager', 'project_manager', 95),
    family('hu', 'uzletvezetes', 'store manager', 'store_manager', 94),
    family('hu', 'etteremvezetes', 'restaurant manager', 'restaurant_manager', 94),
    family('hu', 'szoftverfejlesztes', 'software developer', 'software_developer', 95),
    family('hu', 'halozatadminisztracio', 'network administrator', 'network_administrator', 94),
    family('hu', 'konyveles', 'accounting clerk', 'accounting_clerk', 94),
    family('hu', 'human eroforras', 'human resources assistant', 'human_resources_assistant', 94),
    family('hu', 'szallitas es kezbesites', 'delivery driver', 'delivery_driver', 94),
    family('hu', 'teherauto vezeto', 'truck driver', 'truck_driver', 94),
    family('hu', 'autobusz vezeto', 'bus driver', 'bus_driver', 94),
    family('hu', 'takaritas es fenntartas', 'cleaner', 'cleaner', 94),
    family('hu', 'biztonsagi szolgaltatas', 'security guard', 'security_guard', 94),
    family('hu', 'recepcio', 'receptionist', 'receptionist', 94),
    family('hu', 'penzkezeles', 'cashier', 'cashier', 94),
    family('hu', 'vendeglatas', 'waiter and bartender', 'waiter_bartender', 93),
    family('hu', 'szerviz technikus', 'service technician', 'service_technician', 94),
    family('hu', 'epulet karbantartas', 'maintenance technician', 'maintenance_technician', 94),
    family('et', 'kontori haldus', 'office administrator', 'office_administrator', 95),
    family('et', 'administratiivne tugi', 'administrative assistant', 'administrative_assistant', 95),
    family('et', 'andmesisestus', 'data entry clerk', 'data_entry_clerk', 95),
    family('et', 'kõnekeskus', 'call center representative', 'call_center_representative', 95),
    family('et', 'müügitoetus', 'sales representative', 'sales_representative', 95),
    family('et', 'müügiesindaja', 'sales representative', 'sales_representative', 95),
    family('et', 'kaupluseassistent', 'sales assistant', 'sales_assistant', 95),
    family('et', 'laotootaja', 'warehouse worker', 'warehouse_worker', 94),
    family('et', 'logistikatootaja', 'logistics clerk', 'logistics_clerk', 94),
    family('et', 'tootmistootaja', 'production worker', 'production_worker', 94),
    family('et', 'hooldustehnik', 'maintenance technician', 'maintenance_technician', 94),
    family('et', 'projektijuhtimine', 'project manager', 'project_manager', 95),
    family('et', 'poe juhtimine', 'store manager', 'store_manager', 94),
    family('et', 'restorani juhtimine', 'restaurant manager', 'restaurant_manager', 94),
    family('et', 'tarkvaraarendus', 'software developer', 'software_developer', 95),
    family('et', 'võrguadministreerimine', 'network administrator', 'network_administrator', 94),
    family('et', 'raamatupidamine', 'accounting clerk', 'accounting_clerk', 94),
    family('et', 'personalitöö', 'human resources assistant', 'human_resources_assistant', 94),
    family('et', 'transport ja tarne', 'delivery driver', 'delivery_driver', 94),
    family('et', 'veokijuht', 'truck driver', 'truck_driver', 94),
    family('et', 'bussijuht', 'bus driver', 'bus_driver', 94),
    family('et', 'koristus ja hooldus', 'cleaner', 'cleaner', 94),
    family('et', 'turvateenus', 'security guard', 'security_guard', 94),
    family('et', 'vastuvott', 'receptionist', 'receptionist', 94),
    family('et', 'kassapidamine', 'cashier', 'cashier', 94),
    family('et', 'toitlustus', 'waiter and bartender', 'waiter_bartender', 93),
    family('et', 'teenindustehnik', 'service technician', 'service_technician', 94),
    family('et', 'hoone hooldus', 'maintenance technician', 'maintenance_technician', 94)
];
const FAMILY_ALIAS_ENTRIES_BY_LOCALE = {
    en: FAMILY_ALIAS_ENTRIES.filter((entry) => entry.locale === 'en'),
    ro: FAMILY_ALIAS_ENTRIES.filter((entry) => entry.locale === 'ro'),
    hu: FAMILY_ALIAS_ENTRIES.filter((entry) => entry.locale === 'hu'),
    et: FAMILY_ALIAS_ENTRIES.filter((entry) => entry.locale === 'et'),
    unknown: []
};
export function familyAliasEntries(locale) {
    const reviewedEntries = reviewedFamilyAliasEntries();
    const localeEntries = [
        ...(FAMILY_ALIAS_ENTRIES_BY_LOCALE[locale] ?? FAMILY_ALIAS_ENTRIES_BY_LOCALE.unknown),
        ...reviewedEntries.filter((entry) => entry.locale === locale)
    ];
    const englishEntries = [...FAMILY_ALIAS_ENTRIES_BY_LOCALE.en, ...reviewedEntries.filter((entry) => entry.locale === 'en')];
    const seen = new Set();
    return [...localeEntries, ...englishEntries].filter((entry) => {
        const key = `${entry.locale}\0${entry.surface}\0${entry.canonicalEnglish}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}
export function findFamilyAliasMatch(value, locale) {
    const foldedTokens = tokenizeNormalizedText(foldSearchText(normalizeSearchSurfaceText(value)));
    const surfaceTokens = tokenizeNormalizedText(normalizeSearchSurfaceText(value));
    if (foldedTokens.length < 2 || surfaceTokens.length < 2) {
        return null;
    }
    const candidates = familyAliasEntries(locale);
    let best = null;
    for (const entry of candidates) {
        const entrySurfaceTokens = tokenizeNormalizedText(foldSearchText(entry.surface));
        const canonicalTokens = tokenizeNormalizedText(foldSearchText(entry.canonicalEnglish));
        if (entrySurfaceTokens.length < 2 || entrySurfaceTokens.length > foldedTokens.length) {
            continue;
        }
        for (let start = 0; start <= foldedTokens.length - entrySurfaceTokens.length; start += 1) {
            const maxWindowSize = Math.min(entrySurfaceTokens.length + 1, foldedTokens.length - start);
            for (let windowSize = entrySurfaceTokens.length; windowSize <= maxWindowSize; windowSize += 1) {
                const end = start + windowSize;
                const candidateTokens = foldedTokens.slice(start, end);
                const match = compareTokenPhraseWithOptionalLinkers(candidateTokens, entrySurfaceTokens, locale);
                if (!match.ok) {
                    continue;
                }
                const candidate = {
                    ...entry,
                    startToken: start,
                    endToken: end,
                    approximate: match.approximate,
                    surfaceTokens: surfaceTokens.slice(start, end),
                    canonicalTokens
                };
                if (!best || comparePhraseMatch(candidate, best) > 0) {
                    best = candidate;
                }
            }
        }
    }
    return best;
}
function family(locale, surface, canonicalEnglish, roleKey, priority) {
    return {
        locale,
        surface,
        canonicalEnglish,
        roleKey,
        priority
    };
}
function comparePhraseMatch(left, right) {
    const leftLength = left.endToken - left.startToken;
    const rightLength = right.endToken - right.startToken;
    return (rightLength - leftLength ||
        Number(right.approximate) - Number(left.approximate) ||
        right.priority - left.priority ||
        left.startToken - right.startToken ||
        left.surface.localeCompare(right.surface));
}
function tokenizeNormalizedText(value) {
    return value
        .split(/[^\p{L}\p{N}]+/u)
        .map((token) => token.trim())
        .filter(Boolean);
}
