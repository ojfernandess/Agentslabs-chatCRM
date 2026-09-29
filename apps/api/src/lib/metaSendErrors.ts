/** Classificação e diagnóstico seguro de erros no envio Meta Cloud API. */

export type MetaSendErrorKind =
  | "META_CONFIGURATION_ERROR"
  | "META_NETWORK_ERROR"
  | "META_API_ERROR"
  | "META_MISSING_MESSAGE_ID";

export type FetchErrorDiagnostics = {
  name?: string;
  message?: string;
  causeCode?: string;
  causeMessage?: string;
  errno?: number | string;
  syscall?: string;
  hostname?: string;
};

export class MetaSendError extends Error {
  readonly kind: MetaSendErrorKind;
  readonly httpStatus?: number;
  readonly metaCode?: number;
  readonly networkCause?: string;
  readonly diagnostics?: FetchErrorDiagnostics;

  constructor(
    kind: MetaSendErrorKind,
    message: string,
    opts?: {
      cause?: unknown;
      httpStatus?: number;
      metaCode?: number;
      networkCause?: string;
      diagnostics?: FetchErrorDiagnostics;
    },
  ) {
    super(message, { cause: opts?.cause });
    this.name = "MetaSendError";
    this.kind = kind;
    this.httpStatus = opts?.httpStatus;
    this.metaCode = opts?.metaCode;
    this.networkCause = opts?.networkCause;
    this.diagnostics = opts?.diagnostics;
  }

  static configuration(detail: string): MetaSendError {
    return new MetaSendError("META_CONFIGURATION_ERROR", `META_CONFIGURATION_ERROR: ${detail}`);
  }

  static network(err: unknown, diagnostics: FetchErrorDiagnostics): MetaSendError {
    const cause = diagnostics.causeCode ?? diagnostics.causeMessage ?? diagnostics.message ?? "unknown";
    const msg = `META_NETWORK_ERROR: ${cause}`;
    return new MetaSendError("META_NETWORK_ERROR", msg, {
      cause: err instanceof Error ? err : undefined,
      networkCause: cause,
      diagnostics,
    });
  }

  static api(httpStatus: number, metaCode: number | undefined, metaMessage: string | undefined, raw?: string): MetaSendError {
    const parts = [`HTTP ${httpStatus}`];
    if (metaCode != null) parts.push(`code ${metaCode}`);
    if (metaMessage?.trim()) parts.push(metaMessage.trim());
    const msg = `META_API_ERROR: ${parts.join(" — ")}`;
    return new MetaSendError("META_API_ERROR", msg, { httpStatus, metaCode });
  }

  static missingMessageId(): MetaSendError {
    return new MetaSendError(
      "META_MISSING_MESSAGE_ID",
      "META_MISSING_MESSAGE_ID: HTTP 200 without messages[0].id",
    );
  }
}

function readCauseField(cause: unknown, key: string): unknown {
  if (cause == null || typeof cause !== "object") return undefined;
  return (cause as Record<string, unknown>)[key];
}

/** Extrai causa de rede de erros Node/Undici sem expor credenciais. */
export function extractFetchErrorDiagnostics(err: unknown): FetchErrorDiagnostics {
  const out: FetchErrorDiagnostics = {};
  if (err instanceof Error) {
    out.name = err.name;
    out.message = err.message;
    const cause = err.cause;
    if (cause instanceof Error) {
      out.causeMessage = cause.message;
      out.causeCode = typeof readCauseField(cause, "code") === "string"
        ? (readCauseField(cause, "code") as string)
        : undefined;
      const errno = readCauseField(cause, "errno");
      if (typeof errno === "number" || typeof errno === "string") out.errno = errno;
      const syscall = readCauseField(cause, "syscall");
      if (typeof syscall === "string") out.syscall = syscall;
      const hostname = readCauseField(cause, "hostname");
      if (typeof hostname === "string") out.hostname = hostname;
    } else if (cause != null) {
      out.causeMessage = String(cause);
    }
    if (!out.causeCode) {
      const code = readCauseField(err, "code");
      if (typeof code === "string") out.causeCode = code;
    }
  } else if (err != null) {
    out.message = String(err);
  }
  return out;
}

export function maskPhoneNumberId(phoneNumberId: string): string {
  const id = phoneNumberId.trim();
  if (!id) return "(empty)";
  if (id.length <= 4) return `***${id}`;
  return `***${id.slice(-4)}`;
}

export function validateMetaPhoneNumberId(phoneNumberId: string): void {
  const id = phoneNumberId?.trim() ?? "";
  if (!id || id === "undefined" || id === "null") {
    throw MetaSendError.configuration("phoneNumberId missing");
  }
  if (!/^\d+$/.test(id)) {
    throw MetaSendError.configuration("phoneNumberId invalid");
  }
}

export function validateMetaSendConfig(phoneNumberId: string, apiKey: string): void {
  validateMetaPhoneNumberId(phoneNumberId);
  const token = apiKey?.trim() ?? "";
  if (!token) {
    throw MetaSendError.configuration("accessToken missing");
  }
}

export function buildMetaMessagesUrl(baseUrl: string, phoneNumberId: string): string {
  validateMetaPhoneNumberId(phoneNumberId);
  const id = phoneNumberId.trim();
  const base = baseUrl.replace(/\/+$/, "");
  if (!base.includes("graph.facebook.com")) {
    throw MetaSendError.configuration("graphApiEndpoint invalid");
  }
  return `${base}/${id}/messages`;
}

export function formatMetaSendErrorForStorage(err: unknown): string {
  if (err instanceof MetaSendError) return err.message;
  if (err instanceof Error) {
    const diag = extractFetchErrorDiagnostics(err);
    if (/\bfetch failed\b/i.test(err.message) || diag.causeCode) {
      const cause = diag.causeCode ?? diag.causeMessage ?? err.message;
      return `META_NETWORK_ERROR: ${cause}`;
    }
    if (/^Meta API error:/i.test(err.message)) {
      return err.message.replace(/^Meta API error:/i, "META_API_ERROR:");
    }
    return err.message;
  }
  return String(err);
}

export function isMetaNetworkProviderError(providerError: string | null | undefined): boolean {
  const t = providerError?.trim() ?? "";
  return /^META_NETWORK_ERROR:/i.test(t) || /\bfetch failed\b/i.test(t);
}

export function isMetaConfigurationProviderError(providerError: string | null | undefined): boolean {
  return /^META_CONFIGURATION_ERROR:/i.test(providerError?.trim() ?? "");
}

/** Erros de entrega WhatsApp/Meta que devem ser 422 (regra de negócio), não 500. */
export function isOutboundWhatsappDeliveryError(message: string): boolean {
  const msg = message.trim();
  if (!msg) return false;
  if (/^META_(API|NETWORK|CONFIGURATION)_ERROR:/i.test(msg)) return true;
  if (/Meta API error/i.test(msg)) return true;
  if (/WhatsApp delivery/i.test(msg)) return true;
  if (/session window/i.test(msg)) return true;
  if (/templates are only supported/i.test(msg)) return true;
  return false;
}
