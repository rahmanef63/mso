// Standardized HTTP fetch seam for feature slices. Normalizes 401/403 auth
// refusals, JSON error payloads, cache policy, and AbortSignal cancellation.

export class FeatureFetchError extends Error {
  readonly status: number;
  readonly code: string;
  readonly isAuthError: boolean;

  constructor(message: string, status: number, code = "request_failed") {
    super(message);
    this.name = "FeatureFetchError";
    this.status = status;
    this.code = code;
    this.isAuthError = status === 401 || status === 403;
  }
}

export type FeatureFetchOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  unauthorizedMessage?: string;
  forbiddenMessage?: string;
};

export async function featureFetch<T>(
  url: string,
  options: FeatureFetchOptions = {},
): Promise<T> {
  const { body, headers, unauthorizedMessage, forbiddenMessage, ...rest } = options;
  const hasJsonBody = body !== undefined && !(body instanceof FormData) && typeof body !== "string";
  const response = await fetch(url, {
    cache: "no-store",
    ...rest,
    headers: {
      ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: hasJsonBody ? JSON.stringify(body) : (body as BodyInit | undefined),
  });

  if (response.status === 401) {
    throw new FeatureFetchError(
      unauthorizedMessage ?? "Sign in to MSO to access this feature.",
      401,
      "unauthorized",
    );
  }
  if (response.status === 403) {
    throw new FeatureFetchError(
      forbiddenMessage ?? "Your current device role cannot perform this action.",
      403,
      "forbidden",
    );
  }

  const payload = (await response.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!response.ok) {
    const code = typeof payload.error === "string" && payload.error ? payload.error : `http_${response.status}`;
    const msg = typeof payload.message === "string" && payload.message
      ? payload.message
      : typeof payload.error === "string" && payload.error
        ? payload.error
        : `Request failed (${response.status})`;
    throw new FeatureFetchError(msg, response.status, code);
  }
  return payload;
}
