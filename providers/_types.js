// Documentation-only JSDoc types for provider modules.

/**
 * @typedef {object} ProviderResult
 * @property {object[]} listings Raw listing objects accepted by normalizeListing().
 */

/**
 * @typedef {object} ProviderContext
 * @property {string} now
 * @property {(path: string) => string} resolvePath
 * @property {(url: string, options?: object) => Promise<string>} fetchText
 * @property {(url: string, options?: object) => Promise<unknown>} fetchJson
 */

/**
 * @typedef {object} Provider
 * @property {string} id Unique provider type.
 * @property {(source: object, context: ProviderContext) => Promise<ProviderResult>} fetch
 */

export {};
