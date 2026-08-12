export class OpenSearchClient {
    config;
    constructor(config) {
        this.config = config;
    }
    async get(path, options = {}) {
        return this.request('GET', path, options);
    }
    async put(path, body, options = {}) {
        return this.request('PUT', path, { ...options, body });
    }
    async post(path, body, options = {}) {
        return this.request('POST', path, { ...options, body });
    }
    async delete(path, options = {}) {
        return this.request('DELETE', path, options);
    }
    async head(path, options = {}) {
        return this.request('HEAD', path, options);
    }
    async request(method, path, options = {}) {
        const controller = options.signal ? undefined : new AbortController();
        const timeout = controller
            ? setTimeout(() => controller.abort(new Error(`OpenSearch request timed out after ${this.config.requestTimeoutMs}ms.`)), this.config.requestTimeoutMs)
            : undefined;
        try {
            const response = await fetchOpenSearch(this.buildUrl(path), method, {
                headers: this.buildHeaders(options.contentType, options.body),
                body: serializeBody(options.body),
                signal: options.signal ?? controller?.signal
            });
            const text = method === 'HEAD' ? '' : await response.text();
            const expectedStatuses = options.expectedStatuses ?? [200];
            if (!expectedStatuses.includes(response.status)) {
                throw new Error(`OpenSearch ${method} ${path} failed with status ${response.status}${text ? `: ${truncate(text, 500)}` : '.'}`);
            }
            return {
                status: response.status,
                body: text ? parseJson(text) : null,
                text
            };
        }
        finally {
            if (timeout) {
                clearTimeout(timeout);
            }
        }
    }
    buildUrl(path) {
        const normalizedPath = path.startsWith('/') ? path : `/${path}`;
        return `${this.config.node}${normalizedPath}`;
    }
    buildHeaders(contentType, body) {
        const headers = new Headers();
        const resolvedContentType = contentType ?? (typeof body === 'string' ? 'application/json' : body ? 'application/json' : undefined);
        headers.set('accept', 'application/json');
        if (resolvedContentType) {
            headers.set('content-type', resolvedContentType);
        }
        if (this.config.username) {
            const token = Buffer.from(`${this.config.username}:${this.config.password ?? ''}`, 'utf8').toString('base64');
            headers.set('authorization', `Basic ${token}`);
        }
        return headers;
    }
}
async function fetchOpenSearch(url, method, init) {
    try {
        return await fetch(url, {
            method,
            headers: init.headers,
            body: init.body,
            signal: init.signal
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const cause = error instanceof Error && error.cause instanceof Error ? ` cause=${error.cause.message}` : '';
        throw new Error(`OpenSearch ${method} ${url} request failed: ${message}${cause}`, { cause: error });
    }
}
function serializeBody(body) {
    if (body === undefined) {
        return undefined;
    }
    return typeof body === 'string' ? body : JSON.stringify(body);
}
function parseJson(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
}
function truncate(value, maxLength) {
    return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
