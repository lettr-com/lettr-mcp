const BASE_URL = 'https://app.lettr.com/api';

export interface LettrError {
  message: string;
  error_code?: string;
  errors?: Record<string, string[]>;
}

export interface LettrResponse<T> {
  message: string;
  data: T;
}

export class LettrClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
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
    };

    const options: RequestInit = { method, headers };

    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), options);
    const json = await response.json();

    if (!response.ok) {
      const err = json as LettrError;
      const detail = err.errors
        ? `\n${Object.entries(err.errors)
            .map(([field, msgs]) => `  ${field}: ${msgs.join(', ')}`)
            .join('\n')}`
        : '';
      throw new Error(
        `Lettr API error (${response.status}): ${err.message}${detail}`,
      );
    }

    return json as T;
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
  ): Promise<T> {
    return this.request<T>('POST', path, body, query);
  }

  async put<T>(
    path: string,
    body?: Record<string, unknown>,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    return this.request<T>('PUT', path, body, query);
  }

  async delete<T>(
    path: string,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    return this.request<T>('DELETE', path, undefined, query);
  }
}
