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

interface CollarEdge {
  collar: string;
  confidence: number;
}

export class CollarMap {
  private constructor(private readonly map: Map<string, CollarEdge>) {}

  static async load(dir: string): Promise<CollarMap | undefined> {
    try {
      const data = JSON.parse(await readFile(join(dir, 'occupation_collar.json'), 'utf8')) as Record<
        string,
        CollarEdge
      >;
      return new CollarMap(new Map(Object.entries(data)));
    } catch {
      return undefined;
    }
  }

  static fromEntries(entries: Record<string, CollarEdge>): CollarMap {
    return new CollarMap(new Map(Object.entries(entries)));
  }

  get size(): number {
    return this.map.size;
  }

  lookup(occupationKey: string): CollarEdge | undefined {
    return this.map.get(occupationKey);
  }
}
