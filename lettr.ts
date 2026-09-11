const BASE_URL = 'https://app.lettr.com/api';

export interface LettrError {
  message: string;
  error_code?: string;
  errors?: Record<string, string[]>;
}

/**
 * A send that reused an idempotency key.
 *
 * `replayed` is read from the `Idempotency-Replayed` response header, not the
 * body: the API returns the original transmission verbatim, so the body alone
 * cannot tell you whether a second email actually went out.
 */
export interface WithReplayed<T> {
  data: T;
  replayed: boolean;
}

export interface LettrResponse<T> {
  message: string;
  data: T;
}

export class LettrClient {
  private apiKey: string;
  private version: string;

  constructor(apiKey: string, version: string) {
    this.apiKey = apiKey;
    this.version = version;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    query?: Record<string, string | number | undefined>,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const { data } = await this.requestWithHeaders<T>(
      method,
      path,
      body,
      query,
      extraHeaders,
    );
    return data;
  }

  private async requestWithHeaders<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    query?: Record<string, string | number | undefined>,
    extraHeaders?: Record<string, string>,
  ): Promise<{ data: T; headers: Headers }> {
    const url = new URL(`${BASE_URL}${path}`);

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      'User-Agent': `lettr-mcp/${this.version}`,
      ...extraHeaders,
    };

    const options: RequestInit = { method, headers };

    if (
      body &&
      (method === 'POST' ||
        method === 'PUT' ||
        method === 'PATCH' ||
        method === 'DELETE')
    ) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), options);

    const hasBody =
      response.status !== 204 && response.headers.get('content-length') !== '0';
    const json = hasBody ? await response.json() : undefined;

    if (!response.ok) {
      const err = (json ?? {}) as LettrError;
      const detail = err.errors
        ? `\n${Object.entries(err.errors)
            .map(([field, msgs]) => `  ${field}: ${msgs.join(', ')}`)
            .join('\n')}`
        : '';

      // The two idempotency 409s look identical but call for opposite
      // reactions, so say which one happened rather than leaving the agent to
      // guess from the message.
      if (response.status === 409) {
        const retryAfter = response.headers.get('Retry-After');
        if (err.error_code === 'idempotency_in_progress') {
          throw new Error(
            `Lettr API error (409): an earlier send with this idempotency key is still in flight. Retry with the SAME key${retryAfter ? ` after ${retryAfter}s` : ''}.`,
          );
        }
        if (err.error_code === 'idempotency_key_conflict') {
          throw new Error(
            'Lettr API error (409): this idempotency key was already used with a different payload. Do NOT retry — it will fail identically forever. Use a new key, or resend the original payload.',
          );
        }
      }

      throw new Error(
        `Lettr API error (${response.status}): ${err.message ?? response.statusText}${detail}`,
      );
    }

    return { data: json as T, headers: response.headers };
  }

  async get<T>(
    path: string,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    return this.request<T>('GET', path, undefined, query);
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown>,
    query?: Record<string, string | number | undefined>,
    headers?: Record<string, string>,
  ): Promise<T> {
    return this.request<T>('POST', path, body, query, headers);
  }

  /**
   * POST an idempotent request.
   *
   * Reusing the key returns the original result instead of repeating the
   * action; `replayed` says whether that is what happened.
   */
  async postIdempotent<T>(
    path: string,
    body: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<WithReplayed<T>> {
    const { data, headers } = await this.requestWithHeaders<T>(
      'POST',
      path,
      body,
      undefined,
      { 'Idempotency-Key': idempotencyKey },
    );

    return {
      data,
      // Case-insensitive to match every Lettr SDK. The spec pins the value to
      // the literal 'true', but a strict compare here would silently report
      // "not replayed" if that ever varied - and a missed replay reads as a
      // second email having gone out.
      replayed: headers.get('Idempotency-Replayed')?.toLowerCase() === 'true',
    };
  }

  async put<T>(
    path: string,
    body?: Record<string, unknown>,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    return this.request<T>('PUT', path, body, query);
  }

  async patch<T>(
    path: string,
    body?: Record<string, unknown>,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    return this.request<T>('PATCH', path, body, query);
  }

  async delete<T>(
    path: string,
    body?: Record<string, unknown>,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    return this.request<T>('DELETE', path, body, query);
  }
}
