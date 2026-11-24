// structuredClone throws DataCloneError on Svelte 5 $state proxies, so clone
// through JSON. Every cloned value here is plain JSON data by contract.
export function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
