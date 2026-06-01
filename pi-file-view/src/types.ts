export type FileViewMode = "tree" | "git";

export interface FileEntry {
  path: string;
  name: string;
  isDirectory: boolean;
  gitStatus?: string; // M, A, D, ??, etc.
}
