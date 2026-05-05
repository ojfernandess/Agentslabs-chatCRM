const API_BASE = "/api/v1";

class ApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      ...((options.headers as Record<string, string>) ?? {}),
    };

    // Only declare JSON when there is a body; Fastify rejects POST with
    // Content-Type: application/json and an empty body (FST_ERR_CTP_EMPTY_JSON_BODY).
    if (options.method !== "DELETE" && options.body != null) {
      headers["Content-Type"] = "application/json";
    }

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    if (response.status === 204) {
      return undefined as T;
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        message: response.statusText,
      }));
      throw new ApiError(
        error.message || "Request failed",
        response.status,
      );
    }

    return response.json();
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "PATCH",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  delete(path: string): Promise<void> {
    return this.request(path, { method: "DELETE" });
  }

  /** Multipart upload — não define Content-Type (browser define boundary). */
  async uploadMessageAudio(blob: Blob, filename = "voice.webm"): Promise<{ mediaUrl: string }> {
    const form = new FormData();
    form.append("file", blob, filename);
    const headers: Record<string, string> = {};
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    const response = await fetch(`${API_BASE}/messages/upload-audio`, {
      method: "POST",
      headers,
      body: form,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({
        message: response.statusText,
      }));
      throw new ApiError(error.message || "Upload failed", response.status);
    }
    return response.json();
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const api = new ApiClient();
