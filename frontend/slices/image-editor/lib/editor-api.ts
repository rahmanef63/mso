/** Imperative handle exposed by ImageEditor without coupling the shell back to its root component. */
export type EditorApi = { exportPng: () => string | null; flushProject: () => void; revision: () => number; markSaved: (revision: number) => boolean };
