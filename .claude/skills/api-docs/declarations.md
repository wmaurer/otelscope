# Comment shape, tags, modules, and links

## Shape

````ts
/**
 * Short description as one paragraph.
 *
 * **When to use**
 *
 * Use when ...
 *
 * **Details**
 *
 * Details of complex behavior.
 *
 * **Gotchas**
 *
 * Concrete caveats.
 *
 * **Example** (Parsing a config file)
 *
 * ```ts
 * ...
 * ```
 *
 * @see {@link parseConfigSync} for the synchronous version
 * @category constructors
 * @since 1.2.0
 */
````

Separate the description, each section, each example, and the tags with exactly one blank line. Use prose for one fact and bullets for parallel facts. Add no other headings. `**When to use**` starts with `Use to`, `Use when`, `Use as`, or `Use with`. A comparison with a sibling API goes in `@see`, not in `**When to use**`. Write an example as an `**Example**` section, not as an `@example` tag or a loose code fence.

## Tags

Tags appear in this order: `@deprecated`, `@default`, `@see`, `@category`, `@since`.

- An exported declaration needs `@since` and exactly one `@category`, and has no `@default`.
- A namespace and the declarations inside it need `@since`. They may have `@category` and have no `@default`.
- A member, such as an interface field, needs no comment. If it has one, it may have `@since` and `@default`, has no `@category`, and follows the same prose rules.
- Any declaration may have one `@deprecated` and several `@see` tags. Each needs text.
- `@since` is the package version that first shipped the API, written as `major.minor.patch`.

## Modules

The first top-level JSDoc block in a file is the module comment when an import follows it. When a declaration follows it directly, TypeScript attaches the block to that declaration. The module comment says what the module is for. It does not use the declaration sections. Its tags are an optional `@deprecated`, optional `@see` tags, and a required `@since`. A module marked `@internal` has no public docs.

## Links

An inline `{@link Symbol}` must name a TypeScript symbol that resolves. Use a normal Markdown link for a URL. Use code formatting instead of a link when navigation does not help the reader choose the API.

Use `@see` only for a related public API that you checked: a close alternative, an inverse, a complement, a variant at another level, or a type that the API returns, takes, or is configured by. Explain a relationship that is not obvious. Leave out implementation dependencies, broad concepts, helpers used only in examples, private APIs, and names that only look similar.
