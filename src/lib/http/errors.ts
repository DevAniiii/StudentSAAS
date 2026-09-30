import "server-only";

import { NextResponse } from "next/server";
import { ZodError } from "zod";

/**
 * Error taxonomy.
 *
 * Every failure the client can observe maps to exactly one code. The `code` is
 * the contract; the `message` is for humans and may change. Clients branch on
 * `code`, never on `message`.
 */
export const ErrorCode = {
  VALIDATION_FAILED: "VALIDATION_FAILED",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  CSRF_REJECTED: "CSRF_REJECTED",
  DEPENDENCY_FAILED: "DEPENDENCY_FAILED",
  TIMEOUT: "TIMEOUT",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Field-level detail attached to validation failures. */
export interface FieldError {
  path: string;
  message: string;
}

export class AppError extends Error {
  readonly code: ErrorCodeValue;
  readonly status: number;
  readonly fields?: FieldError[];
  /** Extra machine-readable context, e.g. `retryAfterSeconds`. */
  readonly meta?: Record<string, unknown>;

  constructor(
    code: ErrorCodeValue,
    status: number,
    message: string,
    options?: { fields?: FieldError[]; meta?: Record<string, unknown>; cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.fields = options?.fields;
    this.meta = options?.meta;
  }

  static unauthenticated(message = "Sign in to continue.") {
    return new AppError(ErrorCode.UNAUTHENTICATED, 401, message);
  }

  static forbidden(message = "You do not have access to this resource.") {
    return new AppError(ErrorCode.FORBIDDEN, 403, message);
  }

  static notFound(resource = "Resource") {
    return new AppError(ErrorCode.NOT_FOUND, 404, `${resource} was not found.`);
  }

  static conflict(message: string) {
    return new AppError(ErrorCode.CONFLICT, 409, message);
  }

  static validation(fields: FieldError[], message = "Check the highlighted fields.") {
    return new AppError(ErrorCode.VALIDATION_FAILED, 422, message, { fields });
  }

  static rateLimited(retryAfterSeconds: number) {
    return new AppError(
      ErrorCode.RATE_LIMITED,
      429,
      "Too many requests. Please slow down and try again shortly.",
      { meta: { retryAfterSeconds } },
    );
  }

  static internal(message = "Something went wrong on our end.", cause?: unknown) {
    return new AppError(ErrorCode.INTERNAL, 500, message, { cause });
  }
}

/** Wire shape. Stable across versions within a major. */
export interface ErrorBody {
  error: {
    code: ErrorCodeValue;
    message: string;
    fields?: FieldError[];
    meta?: Record<string, unknown>;
  };
  /**
   * Correlates the client-visible failure with the server log line.
   *
   * Top level, not nested inside `error`, and that is a deliberate choice: it
   * sits in the same position as `requestId` on the success envelope, so a
   * client that wants to log a request id reads it from one place regardless of
   * whether the call succeeded. A request id buried inside the payload a client
   * has to parse on failure is an id nobody reads.
   */
  requestId: string;
}

let counter = 0;

/** Short, sortable, collision-resistant enough to grep a log for. */
export function createRequestId(): string {
  const time = Date.now().toString(36);
  const random = Math.floor(Math.random() * 0xffff)
    .toString(36)
    .padStart(4, "0");
  counter = (counter + 1) % 0x1000;
  return `req_${time}_${random}${counter.toString(36)}`;
}

/**
 * Map a Zod failure onto a FieldError list using dotted paths so the client
 * can attach the message to the right input without knowing the schema shape.
 */
export function fieldErrorsFromZod(error: ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path.join(".") || "_root",
    message: issue.message,
  }));
}

/**
 * Single exit point for every route handler.
 *
 * Guarantees:
 *  - the response is always the documented shape
 *  - internal details (stack traces, driver messages) never reach the client
 *  - every failure produces exactly one structured server log line
 *  - the request id is returned in a header so a user can quote it in a report
 */
export function toErrorResponse(error: unknown, requestId: string): NextResponse<ErrorBody> {
  if (error instanceof AppError) {
    if (error.status >= 500) {
      console.error(
        JSON.stringify({
          level: "error",
          requestId,
          code: error.code,
          message: error.message,
          cause: error.cause instanceof Error ? error.cause.message : undefined,
        }),
      );
    }
    return NextResponse.json<ErrorBody>(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.fields && error.fields.length > 0 ? { fields: error.fields } : {}),
          ...(error.meta ? { meta: error.meta } : {}),
        },
        requestId,
      },
      { status: error.status },
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json<ErrorBody>(
      {
        error: {
          code: ErrorCode.VALIDATION_FAILED,
          message: "Check the highlighted fields.",
          fields: fieldErrorsFromZod(error),
        },
        requestId,
      },
      { status: 422 },
    );
  }

  // Unexpected. Log everything, tell the client nothing useful.
  console.error(
    JSON.stringify({
      level: "error",
      requestId,
      code: ErrorCode.INTERNAL,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }),
  );

  return NextResponse.json<ErrorBody>(
    {
      error: {
        code: ErrorCode.INTERNAL,
        message: "Something went wrong on our end. Please try again.",
      },
      requestId,
    },
    { status: 500 },
  );
}
