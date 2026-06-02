export type FileViewMode = "tree" | "git";

export type GitSubmode = "repo-picker" | "repo-tree";

export type GitTreeScope = "changes" | "all";

export interface FileEntry {
  path: string;
  name: string;
  isDirectory: boolean;
  gitStatus?: string; // M, A, D, ??, etc.
  relativePath?: string;
  repoPath?: string;
  isRepo?: boolean;
  inBranchDiff?: boolean;
  staged?: boolean;
  unstaged?: boolean;
  untracked?: boolean;
  changeKind?: string;
}

export interface OverlaySessionState {
  mode: FileViewMode;
  focusedPane: "left" | "right";
  currentDir: string;
  selectedPath: string | null;
  leftScroll: number;
  filterQuery: string;
  selectedRepoPath: string | null;
  gitSubmode: GitSubmode;
  gitTreeScope: GitTreeScope;
  gitBaseRef: string | null;
  rightScrollByPath: Record<string, number>;
}
