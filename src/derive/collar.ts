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
import { CollarBin, type CollarEdge } from './collar-bin.js';

const BIN_NAME = 'occupation_collar.ocb';

export class CollarMap {
  private constructor(
    private readonly bin: CollarBin | undefined,
    private readonly map: Map<string, CollarEdge> | undefined,
  ) {}

  static async load(dir: string): Promise<CollarMap | undefined> {
    try {
      const bin = await CollarBin.load(join(dir, BIN_NAME));
      return new CollarMap(bin, undefined);
    } catch {
      return undefined;
    }
  }

  static fromEntries(entries: Record<string, CollarEdge>): CollarMap {
    return new CollarMap(undefined, new Map(Object.entries(entries)));
  }

  get size(): number {
    return this.bin?.size ?? this.map?.size ?? 0;
  }

  lookup(occupationKey: string): CollarEdge | undefined {
    if (this.bin) return this.bin.lookup(occupationKey);
    return this.map!.get(occupationKey);
  }
}
