let configured;
/** Explicitly set the auth strategy (overrides env auto-detection). `undefined`
 *  restores environment-based detection. */
export function configureOpenSearchAuth(auth) {
    configured = auth;
}
function envAuth() {
    const e = process.env;
    if (e.OPENSEARCH_USERNAME && e.OPENSEARCH_PASSWORD) {
        return { kind: 'basic', username: e.OPENSEARCH_USERNAME, password: e.OPENSEARCH_PASSWORD };
    }
    return { kind: 'none' };
}
/** Same signature and behavior as `fetch`, plus cluster authentication. */
export function opensearchFetch(input, init = {}) {
    const auth = configured ?? envAuth();
    if (auth.kind === 'basic') {
        const headers = new Headers(init.headers);
        if (!headers.has('Authorization')) {
            headers.set('Authorization', `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`);
        }
        return fetch(input, { ...init, headers });
    }
    return fetch(input, init);
}
