import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AppError,
  ErrorCode,
  createRequestId,
  fieldErrorsFromZod,
  toErrorResponse,
} from "./errors";

/** Every list endpoint returns this envelope. Keeps parsing uniform. */
export interface Page<T> {
  items: T[];
  /** Opaque. Pass back as `?cursor=`. Absent when there is no next page. */
  nextCursor?: string;
  /** Optional, cheap, approximate. Only for "of N results"-style copy. */
  totalEstimate?: number;
}

export interface OkEnvelope<T> {
  data: T;
  /**
   * Correlates this response with its server log line.
   *
   * Filled in by `route()`, not by the handler. It has to be: the id is minted
   * once per request by the wrapper, and a handler that generated its own would
   * produce a second, unrelated id — so every route would have to thread one
   * through, and the first one that forgot would quietly ship an empty string.
   * The wrapper is the only place that can guarantee the body id and the
   * `x-request-id` header are the same value.
   */
  requestId: string;
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse<OkEnvelope<T>> {
  return NextResponse.json<OkEnvelope<T>>({ data, requestId: "" }, init);
}

export function created<T>(data: T): NextResponse<OkEnvelope<T>> {
  return ok(data, { status: 201 });
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

/**
 * Cursor pagination.
 *
 * Keyset, not offset. `OFFSET 100000` makes the database walk and discard
 * 100k rows, and it silently skips or repeats rows when the underlying set
 * shifts. A keyset cursor keeps every page the same cost regardless of depth.
 *
 * `sortKey` must be unique within the collection — that uniqueness is what
 * makes the cursor total-ordered, which is what prevents both skips and
 * duplicates when two rows share a timestamp.
 */
export const cursorSchema = z.object({
  /** ISO instant of the last row's sort key. */
  t: z.string().min(1).max(40),
  /** Primary key of the last row, used as the tiebreaker. */
  id: z.string().min(1).max(64),
});

export type Cursor = z.infer<typeof cursorSchema>;

export function encodeCursor(row: { id: string }, sortValue: Date | string): string {
  const t = sortValue instanceof Date ? sortValue.toISOString() : sortValue;
  return Buffer.from(JSON.stringify({ t, id: row.id })).toString("base64url");
}

export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    const result = cursorSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    // A malformed cursor is a client bug, not a server fault. Start from the
    // beginning rather than 400-ing, so a stale bookmark still works.
    return null;
  }
}

/** Shared list query params: cursor pagination plus a bounded page size. */
export const listQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type ListQuery = z.infer<typeof listQuerySchema>;

export function parseListQuery(params: URLSearchParams): ListQuery {
  return listQuerySchema.parse({
    cursor: params.get("cursor") ?? undefined,
    limit: params.get("limit") ?? undefined,
  });
}

/**
 * Wrap a route handler so every endpoint gets request-id propagation, the
 * documented error envelope, and a 405 for the wrong method — without
 * repeating itself in each file.
 */
export function route<Args extends unknown[]>(
  handler: (request: Request, ...args: Args) => Promise<NextResponse>,
) {
  return async (request: Request, ...args: Args): Promise<NextResponse> => {
    const requestId = createRequestId();
    try {
      const response = await handler(request, ...args);
      // The body id is stamped here, not by the handler, so it cannot drift from
      // the header. Cloning is required: a `NextResponse` body is a stream, and
      // it cannot be read twice.
      const stamped = await stampRequestId(response, requestId);
      stamped.headers.set("x-request-id", requestId);
      // Route handlers must never be cached: every response is per-user.
      stamped.headers.set("cache-control", "no-store, private");
      return stamped;
    } catch (error) {
      const response = toErrorResponse(error, requestId);
      response.headers.set("x-request-id", requestId);
      response.headers.set("cache-control", "no-store, private");
      return response;
    }
  };
}

/**
 * Replace the placeholder `requestId` in a success envelope with the real one.
 *
 * Only touches JSON bodies that actually carry an `OkEnvelope`, and passes
 * everything else through untouched.
 *
 * The body has to be re-serialised, because it is a stream and cannot be
 * rewritten in place. That makes preserving the original headers the delicate
 * part: `NextResponse.json(body, { status })` builds a response with a single
 * `content-type` and nothing else, so anything the handler set — `Set-Cookie`
 * above all — is silently dropped. The login route is the proof: it calls
 * `cookies().set(...)` and returns 200, and with the headers discarded the
 * browser never receives a session and every subsequent request is
 * unauthenticated. So the original headers are copied across, and `Set-Cookie`
 * is re-applied value by value because a `Headers` iteration collapses it to a
 * single comma-joined string, which browsers parse as one cookie name.
 */
async function stampRequestId(response: NextResponse, requestId: string): Promise<NextResponse> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    // A handler that built a JSON response with a body that is not JSON. Pass
    // the original through rather than replacing it with an empty one — the
    // caller still needs its headers and status.
    return response;
  }

  // Shape test rather than a status test: a handler is free to answer 201 or
  // 200, and what identifies the envelope is that it has a `data` key.
  if (typeof parsed !== "object" || parsed === null || !("data" in parsed)) {
    return response;
  }

  const stamped = NextResponse.json(
    { ...parsed, requestId },
    { status: response.status, statusText: response.statusText },
  );

  response.headers.forEach((value, key) => {
    // Re-applied below, one value at a time.
    if (key.toLowerCase() === "set-cookie") return;
    stamped.headers.set(key, value);
  });
  for (const cookie of response.headers.getSetCookie()) {
    stamped.headers.append("set-cookie", cookie);
  }

  return stamped;
}

/** Parse a JSON body against a schema, converting failures to AppError. */
export async function parseJson<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 400, "Request body must be valid JSON.", {
      fields: [{ path: "_root", message: "Body is not valid JSON." }],
    });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw AppError.validation(fieldErrorsFromZod(parsed.error));
  }
  return parsed.data;
}
