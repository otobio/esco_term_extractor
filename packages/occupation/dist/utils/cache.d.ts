export declare class BoundedCache<K, V> {
    private readonly maxSize;
    private readonly map;
    constructor(maxSize?: number);
    get(key: K): V | undefined;
    set(key: K, value: V): void;
}
