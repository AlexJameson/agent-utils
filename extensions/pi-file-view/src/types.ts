export type FileViewMode = "tree" | "git";

export type GitSubmode = "repo-picker" | "repo-tree";

export type GitTreeScope = "changes" | "all";

export type DiffLayout = "side-by-side" | "unified";

export type MarkdownPreviewMode = "rendered" | "raw";

export interface FileEntry {
  path: string;
  name: string;
  isDirectory: boolean;
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
  diffLayout: DiffLayout;
  markdownPreviewMode: MarkdownPreviewMode;
  currentDir: string;
  selectedPath: string | null;
  leftScroll: number;
  selectedRepoPath: string | null;
  gitSubmode: GitSubmode;
  gitTreeScope: GitTreeScope;
  gitBaseRef: string | null;
  rightScrollByPath: Record<string, number>;
}
