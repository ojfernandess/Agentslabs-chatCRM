const API_BASE = "/api/v1";
const TOKEN_KEY = "openconduit_token";

class ApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
  }

  /** Token em memória ou localStorage (sessão persistida). */
  getToken(): string | null {
    if (this.token) return this.token;
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    const token = this.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
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

    Object.assign(headers, this.authHeaders());

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

  get<T>(path: string, options?: RequestInit): Promise<T> {
    return this.request<T>(path, options);
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
  async uploadMessageAudio(blob: Blob, filename = "voice.webm"): Promise<{ mediaUrl: string; mimeType: string }> {
    const form = new FormData();
    form.append("file", blob, filename);
    const response = await fetch(`${API_BASE}/messages/upload-audio`, {
      method: "POST",
      headers: this.authHeaders(),
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

  async uploadMessageMedia(file: Blob, filename?: string): Promise<{ mediaUrl: string; mimeType: string }> {
    const form = new FormData();
    form.append("file", file, filename ?? (file instanceof File ? file.name : "attachment"));
    const response = await fetch(`${API_BASE}/messages/upload-media`, {
      method: "POST",
      headers: this.authHeaders(),
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

  /** Multipart form (ex.: importar ficheiro na KB). Não enviar Content-Type — o browser define o boundary. */
  async postMultipart<T>(path: string, form: FormData): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: this.authHeaders(),
      body: form,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({
        message: response.statusText,
      }));
      throw new ApiError(
        typeof (error as { message?: unknown }).message === "string"
          ? (error as { message: string }).message
          : "Request failed",
        response.status,
      );
    }
    return response.json() as Promise<T>;
  }

  /** GET binário / texto (exportações, ficheiros) com o mesmo Bearer da sessão. */
  async fetchBlob(path: string): Promise<Blob> {
    const response = await fetch(`${API_BASE}${path}`, { headers: this.authHeaders() });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new ApiError(
        typeof (error as { message?: unknown }).message === "string"
          ? (error as { message: string }).message
          : "Request failed",
        response.status,
      );
    }
    return response.blob();
  }

  /** GET binário; devolve null em 404/401 (ex.: avatar ainda não em cache). */
  async fetchBlobOptional(path: string): Promise<Blob | null> {
    const response = await fetch(`${API_BASE}${path}`, { headers: this.authHeaders() });
    if (!response.ok) return null;
    const blob = await response.blob();
    return blob.size >= 64 ? blob : null;
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
