import type { BucketConfig, BucketName } from './types.js';
export declare function getDefaultBucketConfigs(): Record<BucketName, BucketConfig>;
export declare function resolveBucketConfig(bucket: BucketName, overrides?: Partial<BucketConfig>): BucketConfig;
