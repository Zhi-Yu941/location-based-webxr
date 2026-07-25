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

## Wisdom (Communities)

- [zip.js GitHub Discussions](https://github.com/gildas-lormeau/zip.js/discussions)
  Maintainer and user discussions. Use for: behavior not settled by the API reference or minimal reproduction tests.
