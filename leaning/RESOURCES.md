# Task 2 TypeScript Boundary Resources

## Knowledge

- [zip.js official README and examples](https://github.com/gildas-lormeau/zip.js/blob/master/README.md)
  The best starting point for the library's reader/writer mental model and supported environments. Use for: orientation and canonical examples.
- [ZipWriter API](https://gildas-lormeau.github.io/zip.js/api/classes/ZipWriter.html)
  Documents `add`, forward-slash paths, and `close`. Use for: creating entries and obtaining the final archive value.
- [ZipReader API](https://gildas-lormeau.github.io/zip.js/api/classes/ZipReader.html)
  Documents `getEntries` and `close`. Use for: archive inventory and reader lifetime.
- [FileEntry API](https://gildas-lormeau.github.io/zip.js/api/interfaces/FileEntry.html)
  Shows the `directory: false` discriminant and `getData` behavior for file entries. Use for: safe TypeScript narrowing.
- [ZipWriterAddDataOptions API](https://gildas-lormeau.github.io/zip.js/api/interfaces/ZipWriterAddDataOptions.html)
  Documents the `directory` option. Use for: writing explicit directory records.
- [MDN: TextEncoder](https://developer.mozilla.org/en-US/docs/Web/API/TextEncoder)
  Browser-standard UTF-8 conversion from strings to `Uint8Array`. Use for: recognizable text fixtures without Node-only APIs.
- [TypeScript Handbook: Object Types](https://www.typescriptlang.org/docs/handbook/2/objects.html)
  Primary TypeScript guide to object shapes, readonly properties, arrays, and tuples. Use for: the model declarations in `model.ts`.
- [TypeScript Handbook: Everyday Types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html)
  Covers aliases, interfaces, unions, and narrowing. Use for: understanding semantic ID aliases and future discriminated camera unions.
- [TypeScript Modules Reference](https://www.typescriptlang.org/docs/handbook/modules/reference)
  Explains type-only exports and their runtime erasure. Use for: designing the `index.ts` package boundary.
- [MDN: Number.isFinite](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/isFinite)
  Defines the non-coercing finite-number check. Use for: intrinsics, pose values, XYZ, and point error.
- [MDN: Number.isSafeInteger](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/isSafeInteger)
  Defines safe integer validation. Use for: IDs and pixel dimensions.
- [MDN: Set](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set)
  Browser-standard collection for unique values. Use for: duplicate detection and camera-reference lookup.
- [MDN: Error cause](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause)
  Documents preservation of original failure context. Use for: the optional cause on `ColmapError`.
- [Vitest expect API](https://vitest.dev/api/expect.html)
  Official matcher reference. Use for: asserting error class and structured fields without coupling tests to full message wording.
- [COLMAP output format](https://colmap.github.io/format.html)
  The primary description of `cameras.txt`, two-line `images.txt`, `points3D.txt`, sparse identifiers, and world-to-camera poses. Use for: understanding the external text format before applying the narrower recorder profile.
- [MDN: TextDecoder fatal mode](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder/fatal)
  Explains why malformed UTF-8 should throw instead of silently becoming replacement characters. Use for: the byte-to-text boundary.
- [MDN: TextDecoder constructor](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder/TextDecoder)
  Documents browser-native decoding options, including BOM handling. Use for: strict browser-compatible decoding.
- [MDN: Number.prototype.toString](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/toString)
  Documents base-10 number formatting and that both zero signs stringify as `0`. Use for: deterministic round-trip-safe generated numeric text.
- [Vitest: parameterized tests](https://vitest.dev/api/test#test-each)
  Official `test.each` reference. Use for: checking many invalid numeric lexemes against the same parser rule.
- [TypeScript Handbook: narrowing and discriminated unions](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions)
  Explains how a literal discriminant narrows a union. Use for: consuming `ModelComparison` safely through its `equal` property.
- [MDN: equality comparisons and sameness](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Equality_comparisons_and_sameness)
  Distinguishes strict equality from `Object.is`, especially for positive and negative zero. Use for: implementing exact no-op numeric checks with the contract's `-0` rule.
- [MDN: Math.abs](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/abs)
  Browser-standard absolute value. Use for: the approved absolute/relative floating comparison.
- [MDN: Math.max](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/max)
  Browser-standard maximum selection. Use for: scaling the semantic floating tolerance.
- [MDN: Map](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map)
  Documents keyed lookup with original key identity and insertion order. Use for: archive path indexes, collision detection, and exact image lookup.
- [MDN: Regular expression character classes](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions/Character_classes)
  Documents explicit ASCII ranges and control-character matching. Use for: validating stored ZIP names and folding only ASCII uppercase letters.
- [TypeScript Handbook: Symbols](https://www.typescriptlang.org/docs/handbook/symbols.html)
  Documents symbol-keyed properties and the distinct identity of `unique symbol` types. Use for: keeping recorder source-archive state opaque at the public boundary.
- [MDN: Array.prototype.find](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/find)
  Documents exact predicate-based selection and the `undefined` missing case. Use for: selecting image ID `1` without relying on model order.
- [Node.js: Process](https://nodejs.org/api/process.html)
  Documents `process.argv`, standard streams, and graceful non-zero status through `process.exitCode`. Use for: the CLI argument and failure boundary.
- [Node.js: File system promises](https://nodejs.org/api/fs.html#promises-api)
  Documents promise-based file reads, writes, status checks, removal, and rename. Use for: verified temporary-file publication and cleanup.
- [Node.js: Path](https://nodejs.org/api/path.html)
  Documents platform-aware `resolve`, `dirname`, `basename`, and `join`. Use for: absolute path policy and sibling temporary placement.
- [Node.js: Buffer and TypedArrays](https://nodejs.org/api/buffer.html#buffers-and-typedarrays)
  Confirms that `Buffer` extends `Uint8Array`. Use for: passing filesystem bytes into the browser-compatible core without text conversion.
- [Node.js: Child processes](https://nodejs.org/api/child_process.html)
  Documents launching a process with a separate argument array and collecting status, stdout, and stderr. Use for: the real CLI subprocess test.

## Wisdom (Communities)

- [zip.js GitHub Discussions](https://github.com/gildas-lormeau/zip.js/discussions)
  Maintainer and user discussions. Use for: behavior not settled by the API reference or minimal reproduction tests.
