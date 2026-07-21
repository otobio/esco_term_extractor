import type { Connection } from 'mysql2/promise';
import { type ManualReviewType } from './build-manual-review-queue.js';
export type ManualReviewQueueStatus = 'pending' | 'approved' | 'rejected' | 'ignored';
export type ManualReviewInspectFormat = 'text' | 'json';
export type InspectManualReviewQueueOptions = {
    status?: ManualReviewQueueStatus;
    reviewType?: ManualReviewType;
    limit?: number;
    format?: ManualReviewInspectFormat;
};
export type InspectManualReviewQueueRow = {
    id: number;
    reviewType: ManualReviewType;
    reviewStatus: ManualReviewQueueStatus;
    localeCode: string | null;
    subjectText: string | null;
    normalizedSubjectText: string | null;
    graphNodeId: number | null;
    graphNodeLabel: string | null;
    reviewerNote: string | null;
    payloadJson: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
};
export declare class ManualReviewQueueInspector {
    private readonly connection;
    constructor(connection: Connection);
    run(options?: InspectManualReviewQueueOptions): Promise<InspectManualReviewQueueRow[]>;
}
export declare function formatManualReviewInspection(rows: InspectManualReviewQueueRow[], format?: ManualReviewInspectFormat): string;
