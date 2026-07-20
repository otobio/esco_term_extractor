/**
 * collar_kind derivation from occupation via the knowledge graph.
 *
 * collar_kind (white/blue/grey) is rarely written in a job post but is a property
 * of the occupation. Given the extracted occupation(s), we look up the
 * `occupation → collar_kind` edge (snapshot in data/occupation_collar.json) and
 * emit the collar with high confidence — it inherits the occupation's certainty.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
export class CollarMap {
    map;
    constructor(map) {
        this.map = map;
    }
    static async load(dir) {
        try {
            const data = JSON.parse(await readFile(join(dir, 'occupation_collar.json'), 'utf8'));
            return new CollarMap(new Map(Object.entries(data)));
        }
        catch {
            return undefined;
        }
    }
    static fromEntries(entries) {
        return new CollarMap(new Map(Object.entries(entries)));
    }
    get size() {
        return this.map.size;
    }
    lookup(occupationKey) {
        return this.map.get(occupationKey);
    }
}
