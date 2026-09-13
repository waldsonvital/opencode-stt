/**
 * Ambient shim for the optional `solid-js` peer dependency.
 *
 * `@opencode/plugin`'s `Storage` types import `Store<T>` from `solid-js/store`,
 * but the STT plugin never renders JSX, so it does not need solid-js at runtime.
 * Declaring `Store<T>` as `T` is enough to keep TS inference working without
 * pulling in a dependency we do not actually use.
 */
declare module "solid-js/store" {
  export type Store<T> = T;
}

export {};