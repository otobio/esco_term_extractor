// Small LRU cache: bounded Map that evicts the least-recently-used entry once `maxSize` is exceeded.
// `get` re-inserts the accessed key so it moves to the "most recent" end; `set` does the same and
// evicts from the "oldest" end (the Map's insertion-order front) when over capacity.
export class BoundedCache {
    maxSize;
    map = new Map();
    constructor(maxSize = 1000) {
        this.maxSize = maxSize;
    }
    get(key) {
        const item = this.map.get(key);
        if (item !== undefined) {
            this.map.delete(key);
            this.map.set(key, item);
        }
        return item;
    }
    set(key, value) {
        if (this.map.has(key)) {
            this.map.delete(key);
        }
        else if (this.map.size >= this.maxSize) {
            const oldestKey = this.map.keys().next().value;
            if (oldestKey !== undefined) {
                this.map.delete(oldestKey);
            }
        }
        this.map.set(key, value);
    }
}
