/** Structured result returned by both model-comparison strategies. */
export type ModelComparison =
  | { readonly equal: true }
  | {
      readonly equal: false;
      readonly path: string;
      readonly reason:
        | 'record-count'
        | 'record-order'
        | 'identifier'
        | 'string-value'
        | 'integer-value'
        | 'numeric-value'
        | 'quaternion-orientation'
        | 'quaternion-sign'
        | 'reference'
        | 'observation'
        | 'track';
    };
