/**
 * Occupation ↔ capability consistency, from the knowledge graph.
 *
 * The taxonomy links each occupation to its essential/optional capabilities and
 * knowledge. After both occupation and capabilities are extracted, we boost the
 * extracted capabilities that the occupation actually needs — surfacing the
 * relevant ones above incidental noise (and thus improving the per-bucket cutoff).
 * We only re-rank; we never invent capabilities the text didn't mention.
 */
import { join } from 'node:path';
import { CapabilitiesBin } from '../capabilities-bin.js';
export class OccupationCapabilityMap {
    bin;
    map;
    constructor(bin, map) {
        this.bin = bin;
        this.map = map;
    }
    /** Loads the packed OCB binary (zero-parse, ArrayBuffer views) — the production path. */
    static async load(dir) {
        try {
            const bin = await CapabilitiesBin.load(join(dir, 'occupation_capabilities.ocb'));
            return new OccupationCapabilityMap(bin, undefined);
        }
        catch {
            return undefined;
        }
    }
    /** In-memory construction (tests, snapshot tooling) — never touches disk. */
    static fromEntries(entries) {
        const map = new Map();
        for (const [occ, v] of Object.entries(entries))
            map.set(occ, { essential: new Set(v.e), optional: new Set(v.o) });
        return new OccupationCapabilityMap(undefined, map);
    }
    get size() {
        return this.bin?.size ?? this.map?.size ?? 0;
    }
    /** 'essential' | 'optional' | null for a capability given an occupation. */
    relation(occupationKey, capabilityKey) {
        if (this.bin)
            return this.bin.relation(occupationKey, capabilityKey);
        const caps = this.map.get(occupationKey);
        if (!caps)
            return null;
        if (caps.essential.has(capabilityKey))
            return 'essential';
        if (caps.optional.has(capabilityKey))
            return 'optional';
        return null;
    }
    /** Essential capability/knowledge keys for an occupation (empty if unknown). */
    essentialFor(occupationKey) {
        if (this.bin)
            return this.bin.essentialFor(occupationKey);
        return [...(this.map.get(occupationKey)?.essential ?? [])];
    }
    has(occupationKey) {
        if (this.bin)
            return this.bin.has(occupationKey);
        return this.map.has(occupationKey);
    }
}
