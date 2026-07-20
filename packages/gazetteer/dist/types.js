/**
 * Types owned by the gazetteer package. Structurally identical to the host app's
 * shared types (TS is structural), so values cross the boundary without adapters.
 * The gazetteer only ever deals with the `location` bucket and its own `gazetteer`
 * method, so those fields are narrowed to exactly what it produces/consumes.
 */
export {};
