import { foldSearchText, normalizeSearchSurfaceText } from '../utils/texts.js';
import type { SupportedQueryLocale } from './query-preparation.js';

export type CommonRolePhraseEntry = {
  locale: SupportedQueryLocale;
  surface: string;
  canonicalEnglish: string;
  roleKey: string;
  priority: number;
};

export type CommonRolePhraseMatch = CommonRolePhraseEntry & {
  startToken: number;
  endToken: number;
  approximate: boolean;
  surfaceTokens: string[];
  canonicalTokens: string[];
};

const COMMON_ROLE_PHRASE_ENTRIES: CommonRolePhraseEntry[] = [
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
  common('en', 'customer care representative', 'customer support representative', 'customer_care_representative', 98),
  common('en', 'support representative', 'customer support representative', 'customer_care_representative', 98),
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
  common('ro', 'reprezentant servicii clienti', 'customer service representative', 'customer_service_representative', 98),
  common('ro', 'consultant vanzari', 'sales representative', 'sales_representative', 95),
  common('ro', 'asistent vanzari', 'sales assistant', 'sales_assistant', 95),
  common('ro', 'reprezentant vanzari', 'sales representative', 'sales_representative', 96),
  common('ro', 'asistent administrativ', 'administrative assistant', 'administrative_assistant', 96),
  common('ro', 'administrator birou', 'office administrator', 'office_administrator', 96),
  common('ro', 'lucrator comercial', 'retail assistant', 'retail_assistant', 95),
  common('ro', 'operator introducere date', 'data entry clerk', 'data_entry_clerk', 98),
  common('ro', 'asistent resurse umane', 'human resources assistant', 'human_resources_assistant', 96),
  common('ro', 'asistent personal', 'personal assistant', 'personal_assistant', 94),
  common('ro', 'asistent clienti', 'customer assistant', 'customer_assistant', 94),
  common('ro', 'asistent relatie clienti', 'customer service assistant', 'customer_service_assistant', 96),
  common('ro', 'ofiter relatii clienti', 'customer relations officer', 'customer_relations_officer', 96),
  common('ro', 'lucrator front office', 'front office clerk', 'front_office_clerk', 95),
  common('ro', 'operator front office', 'front office operator', 'front_office_operator', 95),
  common('ro', 'ofiter de credit', 'credit officer', 'credit_officer', 94),
  common('ro', 'consilier clienti', 'customer advisor', 'customer_advisor', 95),
  common('ro', 'consilier vanzari', 'sales advisor', 'sales_advisor', 95),
  common('ro', 'lucrator call center', 'call center worker', 'call_center_worker', 95),

  common('hu', 'ügyfélszolgálat', 'customer support', 'customer_support', 99),
  common('hu', 'ügyfélszolgálati munkatárs', 'customer support representative', 'customer_support_representative', 100),
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
  common('hu', 'recepciós', 'receptionist', 'receptionist', 95),
  common('hu', 'front office asszisztens', 'front office assistant', 'front_office_assistant', 95),
  common('hu', 'front office ügyintéző', 'front office clerk', 'front_office_clerk', 95),
  common('hu', 'adminisztrációs munkatárs', 'administrative clerk', 'administrative_clerk', 94),
  common('hu', 'ügyintéző', 'clerk', 'clerk', 94),
  common('hu', 'raktári munkatárs', 'warehouse worker', 'warehouse_worker', 95),
  common('hu', 'logisztikai munkatárs', 'logistics worker', 'logistics_worker', 95),
  common('hu', 'bolti eladó', 'shop assistant', 'shop_assistant', 95),
  common('hu', 'pénztáros', 'cashier', 'cashier', 95),
  common('hu', 'ügyfélkezelő munkatárs', 'customer care representative', 'customer_care_representative', 99),
  common('hu', 'ügyfélkezelő operátor', 'customer care operator', 'customer_care_operator', 99),
  common('hu', 'ügyfélkezelő ügyintéző', 'customer care officer', 'customer_care_officer', 99),
  common('hu', 'ügyfélkapcsolati asszisztens', 'customer relations assistant', 'customer_relations_assistant', 99),
  common('hu', 'telefonos ügyintéző', 'phone operator', 'phone_operator', 96),
  common('hu', 'telefonos értékesítő', 'telephone sales representative', 'telephone_sales_representative', 96),

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
  common('et', 'andmesisestaja', 'data entry clerk', 'data_entry_clerk', 95),
  common('et', 'laotöötaja', 'warehouse worker', 'warehouse_worker', 95),
  common('et', 'tootmistöötaja', 'production worker', 'production_worker', 95),
  common('et', 'tootmisoperaator', 'production operator', 'production_operator', 95),
  common('et', 'turvatöötaja', 'security guard', 'security_guard', 95),
  common('et', 'hooldustehnik', 'maintenance technician', 'maintenance_technician', 95),
  common('et', 'teenindusspetsialist', 'service specialist', 'service_specialist', 95),
  common('et', 'kliendihaldur', 'customer manager', 'customer_manager', 95),
  common('et', 'protsessioperaator', 'process operator', 'process_operator', 95)
];
const PHRASES_BY_LOCALE = buildPhraseIndex(COMMON_ROLE_PHRASE_ENTRIES);

export function commonRolePhraseEntries(locale: SupportedQueryLocale): CommonRolePhraseEntry[] {
  const localeEntries = PHRASES_BY_LOCALE.get(locale) ?? [];
  const englishEntries = PHRASES_BY_LOCALE.get('en') ?? [];
  const seen = new Set<string>();

  return [...localeEntries, ...englishEntries].filter((entry) => {
    const key = `${entry.locale}\0${entry.surface}\0${entry.canonicalEnglish}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function findCommonRolePhraseMatch(value: string, locale: SupportedQueryLocale): CommonRolePhraseMatch | null {
  const foldedTokens = tokenizeNormalizedText(foldSearchText(normalizeSearchSurfaceText(value)));
  const surfaceTokens = tokenizeNormalizedText(normalizeSearchSurfaceText(value));

  if (foldedTokens.length < 2 || surfaceTokens.length < 2) {
    return null;
  }

  const candidates = commonRolePhraseEntries(locale);
  let best: CommonRolePhraseMatch | null = null;

  for (const entry of candidates) {
    const entrySurfaceTokens = tokenizeNormalizedText(foldSearchText(entry.surface));
    const canonicalTokens = tokenizeNormalizedText(foldSearchText(entry.canonicalEnglish));

    if (entrySurfaceTokens.length < 2 || entrySurfaceTokens.length > foldedTokens.length) {
      continue;
    }

    for (let start = 0; start <= foldedTokens.length - entrySurfaceTokens.length; start += 1) {
      const end = start + entrySurfaceTokens.length;
      const candidateTokens = foldedTokens.slice(start, end);
      const match = comparePhraseTokens(candidateTokens, entrySurfaceTokens);

      if (!match.ok) {
        continue;
      }

      const candidate: CommonRolePhraseMatch = {
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

  return best;
}

function buildPhraseIndex(entries: CommonRolePhraseEntry[]): Map<SupportedQueryLocale, CommonRolePhraseEntry[]> {
  const byLocale = new Map<SupportedQueryLocale, CommonRolePhraseEntry[]>();

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

function comparePhraseMatch(left: CommonRolePhraseMatch, right: CommonRolePhraseMatch): number {
  const leftLength = left.endToken - left.startToken;
  const rightLength = right.endToken - right.startToken;

  return (
    rightLength - leftLength ||
    Number(right.approximate) - Number(left.approximate) ||
    right.priority - left.priority ||
    left.startToken - right.startToken ||
    left.surface.localeCompare(right.surface)
  );
}

function comparePhraseTokens(candidateTokens: string[], entryTokens: string[]): { ok: boolean; approximate: boolean } {
  let approximate = false;

  for (let index = 0; index < entryTokens.length; index += 1) {
    const candidate = candidateTokens[index] ?? '';
    const expected = entryTokens[index] ?? '';

    if (tokensEquivalent(candidate, expected)) {
      continue;
    }

    if (isEditDistanceAtMostOne(candidate, expected)) {
      approximate = true;
      continue;
    }

    return { ok: false, approximate: false };
  }

  return { ok: true, approximate };
}

function tokensEquivalent(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }

  return foldSearchText(left) === foldSearchText(right);
}

function isEditDistanceAtMostOne(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }

  if (left.length < 4 || right.length < 4) {
    return false;
  }

  const a = foldSearchText(left);
  const b = foldSearchText(right);

  if (Math.abs(a.length - b.length) > 1) {
    return false;
  }

  let i = 0;
  let j = 0;
  let edits = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }

    edits += 1;

    if (edits > 1) {
      return false;
    }

    if (a.length > b.length) {
      i += 1;
      continue;
    }

    if (b.length > a.length) {
      j += 1;
      continue;
    }

    i += 1;
    j += 1;
  }

  edits += a.length - i + (b.length - j);
  return edits <= 1;
}

function common(
  locale: SupportedQueryLocale,
  surface: string,
  canonicalEnglish: string,
  roleKey: string,
  priority: number
): CommonRolePhraseEntry {
  return {
    locale,
    surface,
    canonicalEnglish,
    roleKey,
    priority
  };
}

function tokenizeNormalizedText(value: string): string[] {
  return value
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}
