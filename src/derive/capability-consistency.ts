/**
 * Occupation ↔ capability consistency, from the knowledge graph.
 *
 * The taxonomy links each occupation to its essential/optional capabilities and
 * knowledge. After both occupation and capabilities are extracted, we boost the
 * extracted capabilities that the occupation actually needs — surfacing the
 * relevant ones above incidental noise (and thus improving the per-bucket cutoff).
 * We only re-rank; we never invent capabilities the text didn't mention.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

interface OccCaps {
  e: string[]; // essential capability/knowledge keys
  o: string[]; // optional
}

export class OccupationCapabilityMap {
  private constructor(private readonly map: Map<string, { essential: Set<string>; optional: Set<string> }>) {}

  static async load(dir: string): Promise<OccupationCapabilityMap | undefined> {
    try {
      const raw = JSON.parse(await readFile(join(dir, 'occupation_capabilities.json'), 'utf8')) as Record<
        string,
        OccCaps
      >;
      const map = new Map<string, { essential: Set<string>; optional: Set<string> }>();
      for (const [occ, v] of Object.entries(raw)) map.set(occ, { essential: new Set(v.e), optional: new Set(v.o) });
      return new OccupationCapabilityMap(map);
    } catch {
      return undefined;
    }
  }

  static fromEntries(entries: Record<string, OccCaps>): OccupationCapabilityMap {
    const map = new Map<string, { essential: Set<string>; optional: Set<string> }>();
    for (const [occ, v] of Object.entries(entries)) map.set(occ, { essential: new Set(v.e), optional: new Set(v.o) });
    return new OccupationCapabilityMap(map);
  }

  get size(): number {
    return this.map.size;
  }

  /** 'essential' | 'optional' | null for a capability given an occupation. */
  relation(occupationKey: string, capabilityKey: string): 'essential' | 'optional' | null {
    const caps = this.map.get(occupationKey);
    if (!caps) return null;
    if (caps.essential.has(capabilityKey)) return 'essential';
    if (caps.optional.has(capabilityKey)) return 'optional';
    return null;
  }

  has(occupationKey: string): boolean {
    return this.map.has(occupationKey);
  }
}
