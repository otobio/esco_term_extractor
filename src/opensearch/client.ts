import type { OpenSearchConfig } from './config.js';

export type OpenSearchRequestOptions = {
  body?: string | object | undefined;
  contentType?: string;
  expectedStatuses?: number[];
  signal?: AbortSignal;
};

export type OpenSearchResponse<T> = {
  status: number;
  body: T | null;
  text: string;
};

export class OpenSearchClient {
  public constructor(private readonly config: OpenSearchConfig) {}

  public async get<T>(path: string, options: Omit<OpenSearchRequestOptions, 'body'> = {}): Promise<OpenSearchResponse<T>> {
    return this.request<T>('GET', path, options);
  }

  public async put<T>(
    path: string,
    body?: string | object,
    options: Omit<OpenSearchRequestOptions, 'body'> = {}
  ): Promise<OpenSearchResponse<T>> {
    return this.request<T>('PUT', path, { ...options, body });
  }

  public async post<T>(
    path: string,
    body?: string | object,
    options: Omit<OpenSearchRequestOptions, 'body'> = {}
  ): Promise<OpenSearchResponse<T>> {
    return this.request<T>('POST', path, { ...options, body });
  }

  public async delete<T>(path: string, options: Omit<OpenSearchRequestOptions, 'body'> = {}): Promise<OpenSearchResponse<T>> {
    return this.request<T>('DELETE', path, options);
  }

  public async head(path: string, options: Omit<OpenSearchRequestOptions, 'body'> = {}): Promise<OpenSearchResponse<null>> {
    return this.request<null>('HEAD', path, options);
  }

  public async request<T>(method: string, path: string, options: OpenSearchRequestOptions = {}): Promise<OpenSearchResponse<T>> {
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
        throw new Error(
          `OpenSearch ${method} ${path} failed with status ${response.status}${text ? `: ${truncate(text, 500)}` : '.'}`
        );
      }

      return {
        status: response.status,
        body: text ? (parseJson(text) as T) : null,
        text
      };
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private buildUrl(path: string): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${this.config.node}${normalizedPath}`;
  }

  private buildHeaders(contentType: string | undefined, body: string | object | undefined): Headers {
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

async function fetchOpenSearch(
  url: string,
  method: string,
  init: { headers: Headers; body: string | undefined; signal: AbortSignal | undefined }
): Promise<Response> {
  try {
    return await fetch(url, {
      method,
      headers: init.headers,
      body: init.body,
      signal: init.signal
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error && error.cause instanceof Error ? ` cause=${error.cause.message}` : '';
    throw new Error(`OpenSearch ${method} ${url} request failed: ${message}${cause}`, { cause: error });
  }
}

function serializeBody(body: string | object | undefined): string | undefined {
  if (body === undefined) {
    return undefined;
  }

  return typeof body === 'string' ? body : JSON.stringify(body);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
