import { foldSearchText, normalizeSearchSurfaceText } from '../utils/texts.js';
import { compareTokenPhraseWithOptionalLinkers } from './phrase-match.js';
import { reviewedCommonRolePhraseEntries } from './reviewed-query-prep-seeds.js';
const COMMON_ROLE_PHRASE_ENTRIES = [
    common('en', 'customer support', 'customer support', 'customer_support', 100),
    common('en', 'customer service', 'customer service', 'customer_service', 99),
    common('en', 'technical support', 'technical support', 'technical_support', 99),
    common('en', 'help desk', 'help desk', 'help_desk', 98),
    common('en', 'call center agent', 'call center agent', 'call_center_agent', 97),
    common('en', 'call centre agent', 'call center agent', 'call_center_agent', 97),
    common('en', 'call center representative', 'call center representative', 'call_center_representative', 97),
    common('en', 'call center operator', 'call center operator', 'call_center_operator', 97),
    common('en', 'call centre operator', 'call center operator', 'call_center_operator', 97),
    common('en', 'sales assistant', 'sales assistant', 'sales_assistant', 96),
    common('en', 'sales representative', 'sales representative', 'sales_representative', 96),
    common('en', 'retail assistant', 'retail assistant', 'retail_assistant', 95),
    common('en', 'shop assistant', 'shop assistant', 'shop_assistant', 95),
    common('en', 'office administrator', 'office administrator', 'office_administrator', 95),
    common('en', 'administrative assistant', 'administrative assistant', 'administrative_assistant', 95),
    common('en', 'data entry clerk', 'data entry clerk', 'data_entry_clerk', 94),
    common('en', 'human resources assistant', 'human resources assistant', 'human_resources_assistant', 94),
    common('en', 'hr assistant', 'human resources assistant', 'human_resources_assistant', 94),
    common('en', 'teacher assistant', 'teacher assistant', 'teacher_assistant', 93),
    common('en', 'customer care representative', 'customer service representative', 'customer_care_representative', 98),
    common('en', 'support representative', 'customer service representative', 'customer_care_representative', 98),
    common('en', 'service representative', 'customer service representative', 'customer_service_representative', 97),
    common('en', 'customer service representative', 'customer service representative', 'customer_service_representative', 99),
    common('en', 'client support', 'customer support', 'customer_support', 95),
    common('en', 'helpdesk', 'help desk', 'help_desk', 95),
    common('en', 'office clerk', 'office clerk', 'office_clerk', 92),
    common('ro', 'suport clienti', 'customer support', 'customer_support', 100),
    common('ro', 'servicii clienti', 'customer service', 'customer_service', 99),
    common('ro', 'relatii cu clientii', 'customer service', 'customer_service', 98),
    common('ro', 'suport tehnic', 'technical support', 'technical_support', 99),
    common('ro', 'birou de asistenta', 'help desk', 'help_desk', 98),
    common('ro', 'help desk', 'help desk', 'help_desk', 97),
    common('ro', 'agent call center', 'call center agent', 'call_center_agent', 97),
    common('ro', 'reprezentant call center', 'call center representative', 'call_center_representative', 97),
    common('ro', 'operator call center', 'call center operator', 'call_center_operator', 97),
    common('ro', 'reprezentant clienti', 'customer service representative', 'customer_service_representative', 96),
    // Removed -- already a real, correctly-attached leaf-specific alias for this exact concept,
    // so retrieval's exact-alias match already covers it without the curated phrase entry.
    // common('ro', 'reprezentant servicii clienti', 'customer service representative', 'customer_service_representative', 98),
    common('ro', 'consultant vanzari', 'sales representative', 'sales_representative', 95),
    // common('ro', 'asistent vanzari', 'sales assistant', 'sales_assistant', 95),
    common('ro', 'reprezentant vanzari', 'sales representative', 'sales_representative', 96),
    // common('ro', 'asistent administrativ', 'administrative assistant', 'administrative_assistant', 96),
    common('ro', 'administrator birou', 'office administrator', 'office_administrator', 96),
    common('ro', 'lucrator comercial', 'retail assistant', 'retail_assistant', 95),
    // common('ro', 'operator introducere date', 'data entry clerk', 'data_entry_clerk', 98),
    // common('ro', 'asistent resurse umane', 'human resources assistant', 'human_resources_assistant', 96),
    common('ro', 'asistent personal', 'personal assistant', 'personal_assistant', 94),
    common('ro', 'asistent clienti', 'customer assistant', 'customer_assistant', 94),
    common('ro', 'asistent relatie clienti', 'customer service assistant', 'customer_service_assistant', 96),
    common('ro', 'ofiter relatii clienti', 'customer relations officer', 'customer_relations_officer', 96),
    common('ro', 'lucrator front office', 'front office clerk', 'front_office_clerk', 95),
    common('ro', 'operator front office', 'front office operator', 'front_office_operator', 95),
    common('ro', 'ofiter de credit', 'credit officer', 'credit_officer', 94),
    common('ro', 'consilier clienti', 'customer advisor', 'customer_advisor', 95),
    common('ro', 'consilier vanzari', 'specialised sales advisor', 'sales_advisor', 95),
    common('ro', 'lucrator call center', 'call center worker', 'call_center_worker', 95),
    common('ro', 'agent vanzari', 'sales representative', 'sales_representative', 96),
    common('ro', 'agenți de vânzări', 'sales representative', 'sales_representative', 96),
    //common('ro', 'agent servicii clienti', 'customer service representative', 'customer_service_representative', 97),
    //common('ro', 'agent servicii client', 'customer service representative', 'customer_service_representative', 96),
    common('ro', 'relatii clienti', 'customer service representative', 'customer_service_representative', 97),
    common('ro', 'sef tura', 'shift supervisor', 'shift_supervisor', 97),
    common('ro', 'responsabil tura', 'shift supervisor', 'shift_supervisor', 97),
    common('ro', 'manager tura', 'shift supervisor', 'shift_supervisor', 96),
    common('ro', 'manager adjunct', 'assistant manager', 'assistant_manager', 95),
    common('ro', 'adjunct manager magazin', 'assistant store manager', 'assistant_store_manager', 96),
    common('ro', 'manager adjunct magazin', 'assistant store manager', 'assistant_store_manager', 96),
    common('ro', 'manager program', 'programme manager', 'programme_manager', 96),
    common('ro', 'manager magazin', 'store manager', 'store_manager', 96),
    // common('ro', 'director de magazin', 'store manager', 'store_manager', 96),
    // common('ro', 'director magazin', 'store manager', 'store_manager', 96),
    // common('ro', 'consultant it', 'ICT consultant', 'ict_consultant', 96),
    common('ro', 'customer agent', 'customer service representative', 'customer_service_representative', 96),
    common('ro', 'support advisor', 'customer service representative', 'customer_support_representative', 96),
    common('ro', 'programator CNC', 'CNC programmer', 'cnc_programmer', 96),
    common('ro', 'operator montaj', 'assembler', 'assembler', 96),
    common('ro', 'operator productie', 'production operator', 'production_operator', 95),
    common('ro', 'operator telesales', 'telesales operator', 'telesales_operator', 95),
    common('ro', 'instalator sanitar', 'plumber', 'plumber', 96),
    common('ro', 'lucrator comenzi', 'warehouse order picker', 'warehouse_order_picker', 95),
    common('ro', 'manipulant marfa', 'material handler', 'material_handler', 96),
    common('ro', 'personal de serviciu', 'cleaner', 'cleaner', 95),
    common('ro', 'manager parc auto', 'fleet manager', 'fleet_manager', 95),
    common('ro', 'sofer livrari', 'delivery driver', 'delivery_driver', 95),
    common('ro', 'mecanic mentenanta', 'maintenance mechanic', 'maintenance_mechanic', 95),
    common('ro', 'electrician intretinere si reparatii', 'maintenance electrician', 'maintenance_electrician', 96),
    common('hu', 'ügyfélszolgálat', 'customer support', 'customer_support', 99),
    common('hu', 'ügyfélszolgálati munkatárs', 'customer service representative', 'customer_support_representative', 100),
    common('hu', 'ügyfélszolgálati ügyintéző', 'customer service representative', 'customer_service_representative', 100),
    common('hu', 'ügyfélszolgálati operátor', 'customer service operator', 'customer_service_operator', 100),
    common('hu', 'ügyfélkapcsolati munkatárs', 'customer relations representative', 'customer_relations_representative', 99),
    common('hu', 'ügyfélkapcsolati ügyintéző', 'customer relations officer', 'customer_relations_officer', 99),
    common('hu', 'ügyfélkapcsolati operátor', 'customer relations operator', 'customer_relations_operator', 99),
    common('hu', 'műszaki támogatás', 'technical support', 'technical_support', 99),
    common('hu', 'műszaki ügyfélszolgálat', 'technical support', 'technical_support', 99),
    common('hu', 'call center operátor', 'call center operator', 'call_center_operator', 97),
    common('hu', 'call center munkatárs', 'call center representative', 'call_center_representative', 97),
    common('hu', 'call center ügyintéző', 'call center officer', 'call_center_officer', 97),
    common('hu', 'értékesítési asszisztens', 'sales assistant', 'sales_assistant', 96),
    common('hu', 'értékesítési képviselő', 'sales representative', 'sales_representative', 96),
    common('hu', 'értékesítési ügyintéző', 'sales administrator', 'sales_administrator', 95),
    common('hu', 'irodai adminisztrátor', 'office administrator', 'office_administrator', 96),
    common('hu', 'adminisztratív asszisztens', 'administrative assistant', 'administrative_assistant', 96),
    common('hu', 'adatbevivő', 'data entry clerk', 'data_entry_clerk', 95),
    common('hu', 'irodai ügyintéző', 'office clerk', 'office_clerk', 95),
    common('hu', 'irodai asszisztens', 'office assistant', 'office_assistant', 95),
    // common('hu', 'recepciós', 'receptionist', 'receptionist', 95),
    common('hu', 'front office asszisztens', 'front office assistant', 'front_office_assistant', 95),
    common('hu', 'front office ügyintéző', 'front office clerk', 'front_office_clerk', 95),
    common('hu', 'adminisztrációs munkatárs', 'administrative clerk', 'administrative_clerk', 94),
    common('hu', 'ügyintéző', 'clerk', 'clerk', 94),
    common('hu', 'raktári munkatárs', 'warehouse worker', 'warehouse_worker', 95),
    common('hu', 'logisztikai munkatárs', 'logistics worker', 'logistics_worker', 95),
    // common('hu', 'bolti eladó', 'shop assistant', 'shop_assistant', 95),
    common('hu', 'pénztáros', 'cashier', 'cashier', 95),
    common('hu', 'ügyfélkezelő munkatárs', 'customer service representative', 'customer_care_representative', 99),
    common('hu', 'ügyfélkezelő operátor', 'customer care operator', 'customer_care_operator', 99),
    common('hu', 'ügyfélkezelő ügyintéző', 'customer care officer', 'customer_care_officer', 99),
    common('hu', 'ügyfélkapcsolati asszisztens', 'customer relations assistant', 'customer_relations_assistant', 99),
    common('hu', 'telefonos ügyintéző', 'phone operator', 'phone_operator', 96),
    common('hu', 'telefonos értékesítő', 'telephone sales representative', 'telephone_sales_representative', 96),
    common('hu', 'projekt menedzser', 'project manager', 'project_manager', 96),
    common('hu', 'projekt vezető', 'project manager', 'project_manager', 96),
    common('et', 'klienditugi', 'customer support', 'customer_support', 99),
    common('et', 'tehniline tugi', 'technical support', 'technical_support', 99),
    common('et', 'klienditeenindaja', 'customer service representative', 'customer_service_representative', 98),
    common('et', 'klienditeenindus', 'customer service', 'customer_service', 98),
    common('et', 'klienditeeninduse töötaja', 'customer service worker', 'customer_service_worker', 98),
    common('et', 'kõnekeskuse operaator', 'call center operator', 'call_center_operator', 97),
    common('et', 'kõnekeskuse töötaja', 'call center worker', 'call_center_worker', 97),
    common('et', 'müügiassistent', 'sales assistant', 'sales_assistant', 96),
    common('et', 'müügikonsultant', 'sales consultant', 'sales_consultant', 96),
    common('et', 'kontoriadministraator', 'office administrator', 'office_administrator', 96),
    common('et', 'kontoriassistent', 'office assistant', 'office_assistant', 96),
    common('et', 'vastuvõtutöötaja', 'receptionist', 'receptionist', 95),
    // common('et', 'andmesisestaja', 'data entry clerk', 'data_entry_clerk', 95),
    common('et', 'laotöötaja', 'warehouse worker', 'warehouse_worker', 95),
    common('et', 'tootmistöötaja', 'production worker', 'production_worker', 95),
    common('et', 'tootmisoperaator', 'production operator', 'production_operator', 95),
    // common('et', 'turvatöötaja', 'security guard', 'security_guard', 95),
    common('et', 'hooldustehnik', 'maintenance technician', 'maintenance_technician', 95),
    common('et', 'teenindusspetsialist', 'service specialist', 'service_specialist', 95),
    common('et', 'kliendihaldur', 'customer manager', 'customer_manager', 95),
    common('et', 'protsessioperaator', 'process operator', 'process_operator', 95),
    common('et', 'poe juht', 'store manager', 'store_manager', 96),
    common('et', 'restorani juht', 'restaurant manager', 'restaurant_manager', 96)
];
const PHRASES_BY_LOCALE = buildPhraseIndex(COMMON_ROLE_PHRASE_ENTRIES);
export function commonRolePhraseEntries(locale, options = {}) {
    const reviewedEntries = reviewedCommonRolePhraseEntries();
    const localeEntries = [...(PHRASES_BY_LOCALE.get(locale) ?? []), ...reviewedEntries.filter((entry) => entry.locale === locale)];
    const englishEntries = [...(PHRASES_BY_LOCALE.get('en') ?? []), ...reviewedEntries.filter((entry) => entry.locale === 'en')];
    const disabledRoleKeys = new Set(options.disabledRoleKeys ?? []);
    const seen = new Set();
    return [...localeEntries, ...englishEntries].filter((entry) => {
        if (disabledRoleKeys.has(entry.roleKey)) {
            return false;
        }
        const key = `${entry.locale}\0${entry.surface}\0${entry.canonicalEnglish}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}
export function disabledCommonRolePhraseSurfaces(locale, disabledRoleKeys = []) {
    if (disabledRoleKeys.length === 0) {
        return [];
    }
    const disabledRoleKeySet = new Set(disabledRoleKeys);
    return commonRolePhraseEntries(locale)
        .filter((entry) => disabledRoleKeySet.has(entry.roleKey))
        .map((entry) => foldSearchText(entry.surface));
}
export function findCommonRolePhraseMatch(value, locale, options = {}) {
    const foldedTokens = tokenizeNormalizedText(foldSearchText(normalizeSearchSurfaceText(value)));
    const surfaceTokens = tokenizeNormalizedText(normalizeSearchSurfaceText(value));
    if (foldedTokens.length < 2 || surfaceTokens.length < 2) {
        return null;
    }
    const candidates = commonRolePhraseEntries(locale, options);
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
function buildPhraseIndex(entries) {
    const byLocale = new Map();
    for (const entry of entries) {
        const bucket = byLocale.get(entry.locale) ?? [];
        bucket.push(entry);
        byLocale.set(entry.locale, bucket);
    }
    for (const bucket of byLocale.values()) {
        bucket.sort((left, right) => {
            const leftLength = tokenizeNormalizedText(foldSearchText(left.surface)).length;
            const rightLength = tokenizeNormalizedText(foldSearchText(right.surface)).length;
            return rightLength - leftLength || right.priority - left.priority || left.surface.localeCompare(right.surface);
        });
    }
    return byLocale;
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
function common(locale, surface, canonicalEnglish, roleKey, priority) {
    return {
        locale,
        surface,
        canonicalEnglish,
        roleKey,
        priority
    };
}
function tokenizeNormalizedText(value) {
    return value
        .split(/[^\p{L}\p{N}]+/u)
        .map((token) => token.trim())
        .filter(Boolean);
}
