/** Shared contextual failure contract for the COLMAP boundary. */

export type ColmapFailureKind =
  | 'archive'
  | 'unsupported-profile'
  | 'syntax'
  | 'validation'
  | 'reference';

export interface ColmapFailureContext {
  readonly kind: ColmapFailureKind;
  readonly path?: string;
  readonly line?: number;
  readonly field?: string;
}

/**
 * The one public error class used by expected 1A input and archive failures.
 * Validation behavior will be added test-first in implementation slice 1.
 */
export class ColmapError extends Error {
  readonly kind: ColmapFailureKind;
  readonly path?: string;
  readonly line?: number;
  readonly field?: string;
  override readonly cause?: unknown;

  constructor(
    message: string,
    context: ColmapFailureContext,
    options?: { readonly cause?: unknown }
  ) {
    super(message, options);
    this.name = 'ColmapError';
    this.kind = context.kind;
    this.path = context.path;
    this.line = context.line;
    this.field = context.field;
    this.cause = options?.cause;
  }
}
