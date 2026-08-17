/**
 * collar_kind derivation from occupation via the knowledge graph.
 *
 * collar_kind (white/blue/grey) is rarely written in a job post but is a property
 * of the occupation. Given the extracted occupation(s), we look up the
 * `occupation -> collar_kind` edge from the packed runtime snapshot
 * (data/occupation_collar.ocb). The returned collar inherits the occupation's
 * certainty.
 */
import { join } from 'node:path';
import { CollarBin } from './collar-bin.js';
const BIN_NAME = 'occupation_collar.ocb';
export class CollarMap {
    bin;
    map;
    constructor(bin, map) {
        this.bin = bin;
        this.map = map;
    }
    static async load(dir) {
        try {
            const bin = await CollarBin.load(join(dir, BIN_NAME));
            return new CollarMap(bin, undefined);
        }
        catch {
            return undefined;
        }
    }
    static fromEntries(entries) {
        return new CollarMap(undefined, new Map(Object.entries(entries)));
    }
    get size() {
        return this.bin?.size ?? this.map?.size ?? 0;
    }
    lookup(occupationKey) {
        if (this.bin)
            return this.bin.lookup(occupationKey);
        return this.map.get(occupationKey);
    }
}
