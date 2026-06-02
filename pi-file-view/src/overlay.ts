import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Input,
  Markdown,
  type MarkdownTheme,
  type Focusable,
  type KeybindingsManager,
  type TUI,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

import type { FileEntry, FileViewMode, GitSubmode, GitTreeScope, OverlaySessionState } from "./types.js";

interface FileViewOptions {
  tui: TUI;
  theme: Theme;
  keybindings: KeybindingsManager;
  cwd: string;
  initialMode: FileViewMode;
  initialState: OverlaySessionState | null;
  onClose: (state: OverlaySessionState) => void;
  onModeChange: (mode: FileViewMode) => void;
}

interface GitFileState {
  changeKind?: string;
  inBranchDiff: boolean;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

export class FileViewOverlay implements Focusable {
  private tui: TUI;
  private theme: Theme;
  private keybindings: KeybindingsManager;
  private cwd: string;
  private onClose: (state: OverlaySessionState) => void;
  private onModeChange: (mode: FileViewMode) => void;

  private mode: FileViewMode;
  private focusedPane: "left" | "right" = "left";
  private leftScroll = 0;
  private rightScroll = 0;
  private selectedIndex = 0;
  private selectedPath: string | null = null;
  private allFiles: FileEntry[] = [];
  private visibleFiles: FileEntry[] = [];
  private previewContent: string[] = [];
  private markdownPreview: Markdown | null = null;
  private markdownPreviewWidth = 0;
  private rightScrollByPath: Record<string, number> = {};
  private closed = false;
  private contentHeight = 0;

  private currentDir: string;
  private filterQuery = "";
  private filterMode = false;
  private filterInput: Input;

  private selectedRepoPath: string | null = null;
  private gitSubmode: GitSubmode = "repo-picker";
  private gitTreeScope: GitTreeScope = "changes";
  private gitBaseRef: string | null = null;
  private gitFileState = new Map<string, GitFileState>();

  focused = false;

  constructor(options: FileViewOptions) {
    this.tui = options.tui;
    this.theme = options.theme;
    this.keybindings = options.keybindings;
    this.cwd = options.cwd;
    this.onClose = options.onClose;
    this.onModeChange = options.onModeChange;

    const initialState = options.initialState;
    this.mode = options.initialMode;
    this.focusedPane = initialState?.focusedPane ?? "left";
    this.currentDir = initialState?.currentDir ?? options.cwd;
    this.leftScroll = initialState?.leftScroll ?? 0;
    this.selectedPath = initialState?.selectedPath ?? null;
    this.filterQuery = initialState?.filterQuery ?? "";
    this.selectedRepoPath = initialState?.selectedRepoPath ?? null;
    this.gitSubmode = initialState?.gitSubmode ?? "repo-picker";
    this.gitTreeScope = initialState?.gitTreeScope ?? "changes";
    this.gitBaseRef = initialState?.gitBaseRef ?? null;
    this.rightScrollByPath = { ...(initialState?.rightScrollByPath ?? {}) };

    this.filterInput = this.createFilterInput();
    this.filterInput.setValue(this.filterQuery);

    if (this.mode === "git" && this.selectedRepoPath && !this.isRepoDirectory(this.selectedRepoPath)) {
      this.selectedRepoPath = null;
      this.gitSubmode = "repo-picker";
    }

    if (this.mode === "git" && this.gitSubmode === "repo-tree" && this.selectedRepoPath) {
      if (!this.isPathInside(this.selectedRepoPath, this.currentDir)) {
        this.currentDir = this.selectedRepoPath;
      }
      this.gitBaseRef = this.gitBaseRef ?? this.detectBaseRef(this.selectedRepoPath);
    }

    this.loadFiles();
  }

  snapshotState(): OverlaySessionState {
    this.saveCurrentPreviewScroll();
    return {
      mode: this.mode,
      focusedPane: this.focusedPane,
      currentDir: this.currentDir,
      selectedPath: this.selectedPath ?? this.selectedFile()?.path ?? null,
      leftScroll: this.leftScroll,
      filterQuery: this.filterQuery,
      selectedRepoPath: this.selectedRepoPath,
      gitSubmode: this.gitSubmode,
      gitTreeScope: this.gitTreeScope,
      gitBaseRef: this.gitBaseRef,
      rightScrollByPath: { ...this.rightScrollByPath },
    };
  }

  private createFilterInput(): Input {
    const input = new Input();
    input.onEscape = () => {
      this.exitFilterMode(false);
    };
    input.onSubmit = () => {
      this.filterMode = false;
      this.tui.requestRender();
    };
    return input;
  }

  private getMarkdownTheme(): MarkdownTheme {
    return {
      heading: (text) => this.theme.fg("mdHeading", text),
      link: (text) => this.theme.fg("mdLink", text),
      linkUrl: (text) => this.theme.fg("mdLinkUrl", text),
      code: (text) => this.theme.fg("mdCode", text),
      codeBlock: (text) => this.theme.fg("mdCodeBlock", text),
      codeBlockBorder: (text) => this.theme.fg("mdCodeBlockBorder", text),
      quote: (text) => this.theme.fg("mdQuote", text),
      quoteBorder: (text) => this.theme.fg("mdQuoteBorder", text),
      hr: (text) => this.theme.fg("mdHr", text),
      listBullet: (text) => this.theme.fg("mdListBullet", text),
      bold: (text) => this.theme.bold(text),
      italic: (text) => this.theme.italic(text),
      underline: (text) => this.theme.underline(text),
      strikethrough: (text) => this.theme.strikethrough(text),
    };
  }

  private renderMarkdownPreview(width: number, fileName: string) {
    if (!this.markdownPreview) {
      return;
    }

    try {
      this.previewContent = this.markdownPreview.render(Math.max(1, width));
      this.markdownPreviewWidth = Math.max(1, width);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.markdownPreview = null;
      this.markdownPreviewWidth = 0;
      this.previewContent = [
        this.theme.fg("error", `Cannot render ${fileName}`),
        "",
        this.theme.fg("dim", message),
      ];
    }
  }

  private selectedFile(): FileEntry | undefined {
    return this.visibleFiles[this.selectedIndex];
  }

  private isPathInside(root: string, maybeChild: string): boolean {
    return maybeChild === root || maybeChild.startsWith(`${root}/`);
  }

  private isRepoDirectory(dir: string): boolean {
    return existsSync(join(dir, ".git"));
  }

  private loadFiles() {
    if (this.mode === "tree") {
      this.loadTreeFiles();
    } else if (this.gitSubmode === "repo-picker" || !this.selectedRepoPath) {
      this.loadRepoPickerFiles();
    } else if (this.gitTreeScope === "changes") {
      this.loadGitChangedFiles();
    } else {
      this.loadGitAllFiles();
    }

    this.refreshVisibleFiles();
    this.loadPreview();
    this.tui.requestRender();
  }

  private refreshVisibleFiles() {
    const query = this.filterQuery.trim().toLowerCase();
    if (!query) {
      this.visibleFiles = [...this.allFiles];
    } else {
      this.visibleFiles = this.allFiles.filter((file) => {
        if (file.name === "..") {
          return true;
        }
        return file.name.toLowerCase().includes(query);
      });
    }

    this.restoreSelection();
  }

  private restoreSelection() {
    if (this.visibleFiles.length === 0) {
      this.selectedIndex = 0;
      this.leftScroll = 0;
      this.selectedPath = null;
      return;
    }

    const savedIndex = this.selectedPath
      ? this.visibleFiles.findIndex((file) => file.path === this.selectedPath)
      : -1;

    this.selectedIndex = savedIndex >= 0 ? savedIndex : Math.min(this.selectedIndex, this.visibleFiles.length - 1);
    this.selectedPath = this.visibleFiles[this.selectedIndex]?.path ?? null;
    this.leftScroll = Math.max(0, Math.min(this.leftScroll, Math.max(0, this.visibleFiles.length - 1)));
    this.adjustLeftScroll();
  }

  private loadTreeFiles() {
    this.allFiles = [];

    const parentDir = dirname(this.currentDir);
    if (parentDir !== this.currentDir) {
      this.allFiles.push({
        path: parentDir,
        name: "..",
        isDirectory: true,
      });
    }

    try {
      const entries = readdirSync(this.currentDir, { withFileTypes: true });
      const dirs: FileEntry[] = [];
      const files: FileEntry[] = [];

      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const fullPath = join(this.currentDir, entry.name);
        const fileEntry: FileEntry = {
          path: fullPath,
          name: entry.name,
          isDirectory: entry.isDirectory(),
        };
        if (entry.isDirectory()) {
          dirs.push(fileEntry);
        } else {
          files.push(fileEntry);
        }
      }

      dirs.sort((a, b) => a.name.localeCompare(b.name));
      files.sort((a, b) => a.name.localeCompare(b.name));
      this.allFiles.push(...dirs, ...files);
    } catch {
      // Leave empty when directory is unreadable.
    }
  }

  private loadRepoPickerFiles() {
    this.gitSubmode = "repo-picker";
    this.currentDir = this.cwd;
    this.gitFileState = new Map();
    this.allFiles = this.discoverRepos(this.cwd, 2);
  }

  private loadGitAllFiles() {
    if (!this.selectedRepoPath) {
      this.loadRepoPickerFiles();
      return;
    }

    if (!this.isPathInside(this.selectedRepoPath, this.currentDir)) {
      this.currentDir = this.selectedRepoPath;
    }

    this.gitFileState = this.collectGitFileState(this.selectedRepoPath);
    this.allFiles = this.buildDirectoryEntries(this.currentDir);

    for (const file of this.allFiles) {
      this.decorateGitEntry(file);
    }
  }

  private loadGitChangedFiles() {
    if (!this.selectedRepoPath) {
      this.loadRepoPickerFiles();
      return;
    }

    if (!this.isPathInside(this.selectedRepoPath, this.currentDir)) {
      this.currentDir = this.selectedRepoPath;
    }

    this.gitFileState = this.collectGitFileState(this.selectedRepoPath);
    this.allFiles = this.buildChangedTreeEntries(this.selectedRepoPath, this.currentDir, this.gitFileState);
  }

  private buildDirectoryEntries(dir: string): FileEntry[] {
    const files: FileEntry[] = [];
    const parentDir = dirname(dir);
    const repoRoot = this.mode === "git" ? this.selectedRepoPath : null;

    if (repoRoot && dir !== repoRoot) {
      files.push({
        path: parentDir,
        name: "..",
        isDirectory: true,
        repoPath: repoRoot,
      });
    }

    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      const dirs: FileEntry[] = [];
      const plainFiles: FileEntry[] = [];

      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const fullPath = join(dir, entry.name);
        const relPath = repoRoot ? relative(repoRoot, fullPath) : undefined;
        const item: FileEntry = {
          path: fullPath,
          name: entry.name,
          isDirectory: entry.isDirectory(),
          repoPath: repoRoot ?? undefined,
          relativePath: relPath,
        };
        if (entry.isDirectory()) {
          dirs.push(item);
        } else {
          plainFiles.push(item);
        }
      }

      dirs.sort((a, b) => a.name.localeCompare(b.name));
      plainFiles.sort((a, b) => a.name.localeCompare(b.name));
      files.push(...dirs, ...plainFiles);
    } catch {
      // Keep whatever was already added.
    }

    return files;
  }

  private buildChangedTreeEntries(repoPath: string, currentDir: string, state: Map<string, GitFileState>): FileEntry[] {
    const entries: FileEntry[] = [];
    const parentDir = dirname(currentDir);
    if (currentDir !== repoPath) {
      entries.push({
        path: parentDir,
        name: "..",
        isDirectory: true,
        repoPath,
      });
    }

    const relDir = currentDir === repoPath ? "" : relative(repoPath, currentDir);
    const children = new Map<string, FileEntry>();

    for (const [relPath, gitState] of state.entries()) {
      let remainder = relPath;
      if (relDir) {
        if (!relPath.startsWith(`${relDir}/`)) {
          continue;
        }
        remainder = relPath.slice(relDir.length + 1);
      }

      const parts = remainder.split("/").filter(Boolean);
      if (parts.length === 0) {
        continue;
      }

      const childName = parts[0];
      const childRelPath = relDir ? `${relDir}/${childName}` : childName;
      const childPath = join(repoPath, childRelPath);

      if (parts.length === 1) {
        children.set(childName, {
          path: childPath,
          name: childName,
          isDirectory: false,
          repoPath,
          relativePath: childRelPath,
          changeKind: gitState.changeKind,
          inBranchDiff: gitState.inBranchDiff,
          staged: gitState.staged,
          unstaged: gitState.unstaged,
          untracked: gitState.untracked,
        });
      } else if (!children.has(childName)) {
        children.set(childName, {
          path: childPath,
          name: childName,
          isDirectory: true,
          repoPath,
          relativePath: childRelPath,
          inBranchDiff: false,
          staged: false,
          unstaged: false,
          untracked: false,
        });
      }

      const child = children.get(childName);
      if (child) {
        child.inBranchDiff = Boolean(child.inBranchDiff || gitState.inBranchDiff);
        child.staged = Boolean(child.staged || gitState.staged);
        child.unstaged = Boolean(child.unstaged || gitState.unstaged);
        child.untracked = Boolean(child.untracked || gitState.untracked);
      }
    }

    const dirs = [...children.values()].filter((entry) => entry.isDirectory).sort((a, b) => a.name.localeCompare(b.name));
    const files = [...children.values()].filter((entry) => !entry.isDirectory).sort((a, b) => a.name.localeCompare(b.name));
    entries.push(...dirs, ...files);
    return entries;
  }

  private decorateGitEntry(file: FileEntry) {
    if (!this.selectedRepoPath || !file.relativePath || file.name === "..") {
      return;
    }

    if (!file.isDirectory) {
      const state = this.gitFileState.get(file.relativePath);
      if (!state) {
        return;
      }
      file.changeKind = state.changeKind;
      file.inBranchDiff = state.inBranchDiff;
      file.staged = state.staged;
      file.unstaged = state.unstaged;
      file.untracked = state.untracked;
      return;
    }

    for (const [relPath, state] of this.gitFileState.entries()) {
      if (!relPath.startsWith(`${file.relativePath}/`)) {
        continue;
      }
      file.inBranchDiff = Boolean(file.inBranchDiff || state.inBranchDiff);
      file.staged = Boolean(file.staged || state.staged);
      file.unstaged = Boolean(file.unstaged || state.unstaged);
      file.untracked = Boolean(file.untracked || state.untracked);
    }
  }

  private collectGitFileState(repoPath: string): Map<string, GitFileState> {
    const state = new Map<string, GitFileState>();
    this.gitBaseRef = this.detectBaseRef(repoPath);
    const mergeBase = this.gitBaseRef ? this.getMergeBase(repoPath, this.gitBaseRef) : null;

    if (mergeBase) {
      this.applyGitNameStatus(state, this.runGitText(repoPath, `git diff --name-status ${JSON.stringify(mergeBase)}...HEAD`), "branch");
    }

    this.applyGitNameStatus(state, this.runGitText(repoPath, "git diff --cached --name-status"), "staged");
    this.applyGitNameStatus(state, this.runGitText(repoPath, "git diff --name-status"), "unstaged");

    const untracked = this.runGitText(repoPath, "git ls-files --others --exclude-standard");
    for (const line of untracked.split("\n").map((item) => item.trim()).filter(Boolean)) {
      const item = this.ensureGitState(state, line);
      item.untracked = true;
      item.changeKind = item.changeKind ?? "??";
    }

    return state;
  }

  private ensureGitState(state: Map<string, GitFileState>, relPath: string): GitFileState {
    const existing = state.get(relPath);
    if (existing) {
      return existing;
    }
    const created: GitFileState = {
      inBranchDiff: false,
      staged: false,
      unstaged: false,
      untracked: false,
    };
    state.set(relPath, created);
    return created;
  }

  private applyGitNameStatus(state: Map<string, GitFileState>, text: string, bucket: "branch" | "staged" | "unstaged") {
    for (const line of text.split("\n").filter(Boolean)) {
      const parsed = this.parseNameStatusLine(line);
      if (!parsed) {
        continue;
      }
      const item = this.ensureGitState(state, parsed.path);
      item.changeKind = item.changeKind ?? parsed.status;
      if (bucket === "branch") {
        item.inBranchDiff = true;
      } else if (bucket === "staged") {
        item.staged = true;
      } else {
        item.unstaged = true;
      }
    }
  }

  private parseNameStatusLine(line: string): { status: string; path: string } | null {
    const parts = line.split("\t");
    if (parts.length < 2) {
      return null;
    }

    const status = parts[0].trim();
    const path = parts.length >= 3 ? parts[2] : parts[1];
    if (!path) {
      return null;
    }

    return { status, path };
  }

  private detectBaseRef(repoPath: string): string | null {
    const candidates = [
      this.runGitText(repoPath, "git symbolic-ref --quiet --short refs/remotes/origin/HEAD"),
      this.runGitText(repoPath, "git rev-parse --verify --quiet origin/main && printf origin/main"),
      this.runGitText(repoPath, "git rev-parse --verify --quiet origin/master && printf origin/master"),
      this.runGitText(repoPath, "git rev-parse --verify --quiet main && printf main"),
      this.runGitText(repoPath, "git rev-parse --verify --quiet master && printf master"),
    ];

    for (const candidate of candidates) {
      const trimmed = candidate.trim();
      if (trimmed) {
        return trimmed.replace(/^refs\/remotes\//, "");
      }
    }

    return null;
  }

  private getMergeBase(repoPath: string, baseRef: string): string | null {
    const result = this.runGitText(repoPath, `git merge-base HEAD ${JSON.stringify(baseRef)}`);
    const trimmed = result.trim();
    return trimmed || null;
  }

  private runGitText(repoPath: string, command: string): string {
    try {
      return execSync(command, {
        cwd: repoPath,
        stdio: "pipe",
        encoding: "utf8",
        timeout: 10000,
      });
    } catch {
      return "";
    }
  }

  private discoverRepos(root: string, depth: number): FileEntry[] {
    const repos = new Map<string, FileEntry>();

    const walk = (dir: string, remainingDepth: number) => {
      if (this.isRepoDirectory(dir)) {
        const display = relative(root, dir) || basename(dir);
        repos.set(dir, {
          path: dir,
          name: display,
          isDirectory: true,
          isRepo: true,
        });
        return;
      }

      if (remainingDepth === 0) {
        return;
      }

      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (entry.name.startsWith(".")) continue;
          if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "out") continue;
          walk(join(dir, entry.name), remainingDepth - 1);
        }
      } catch {
        // Skip unreadable directories.
      }
    };

    walk(root, depth);

    return [...repos.values()].sort((a, b) => {
      const aDepth = (relative(root, a.path).match(/\//g) ?? []).length;
      const bDepth = (relative(root, b.path).match(/\//g) ?? []).length;
      if (aDepth !== bDepth) {
        return aDepth - bDepth;
      }
      return a.name.localeCompare(b.name);
    });
  }

  private saveCurrentPreviewScroll() {
    const file = this.selectedFile();
    if (file?.path) {
      this.rightScrollByPath[file.path] = this.rightScroll;
    }
  }

  private restorePreviewScroll(filePath: string | null) {
    this.rightScroll = filePath ? this.rightScrollByPath[filePath] ?? 0 : 0;
    this.rightScroll = Math.min(this.rightScroll, this.maxRightScroll());
  }

  private maxRightScroll(): number {
    return Math.max(0, this.previewContent.length - this.contentHeight);
  }

  private scrollRightTo(position: number) {
    this.rightScroll = Math.max(0, Math.min(this.maxRightScroll(), position));
    this.tui.requestRender();
  }

  private scrollRightBy(delta: number) {
    this.scrollRightTo(this.rightScroll + delta);
  }

  private loadPreview() {
    this.markdownPreview = null;
    this.markdownPreviewWidth = 0;
    this.previewContent = [];

    const file = this.selectedFile();
    if (!file) {
      this.previewContent = [this.theme.fg("dim", "No file selected")];
      this.restorePreviewScroll(null);
      this.tui.requestRender();
      return;
    }

    this.selectedPath = file.path;

    if (this.mode === "tree") {
      if (!file.isDirectory && file.name.endsWith(".md")) {
        this.loadMarkdownPreview(file);
      } else {
        this.loadFilePreview(file);
      }
    } else if (this.gitSubmode === "repo-picker") {
      this.previewContent = [
        this.theme.fg("accent", file.name),
        "",
        this.theme.fg("dim", file.path),
        "",
        this.theme.fg("dim", "Enter to open repository"),
      ];
    } else {
      this.loadGitPreview(file);
    }

    this.restorePreviewScroll(file.path);
    this.tui.requestRender();
  }

  private loadMarkdownPreview(file: FileEntry) {
    try {
      const content = readFileSync(file.path, "utf8");
      if (content === "") {
        this.previewContent = [this.theme.fg("dim", "(empty file)")];
        return;
      }

      const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      if (!normalized.split("\n").some((line) => line.trim().length > 0)) {
        this.previewContent = [this.theme.fg("dim", "(blank file)")];
        return;
      }

      this.markdownPreview = new Markdown(normalized, 0, 0, this.getMarkdownTheme(), {
        color: (text) => this.theme.fg("text", text),
      });
      this.renderMarkdownPreview(1, file.name);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.previewContent = [
        this.theme.fg("error", `Cannot read ${file.name}`),
        "",
        this.theme.fg("dim", message),
      ];
    }
  }

  private loadFilePreview(file: FileEntry) {
    if (file.isDirectory) {
      if (file.name === "..") {
        this.previewContent = [
          this.theme.fg("dim", "Parent directory"),
          "",
          this.theme.fg("accent", "Enter / h / ←") + this.theme.fg("dim", " to navigate"),
        ];
      } else {
        this.previewContent = [
          this.theme.fg("dim", `Directory: ${file.name}`),
          "",
          this.theme.fg("accent", "Enter / l / →") + this.theme.fg("dim", " to open"),
        ];
      }
      return;
    }

    try {
      const content = readFileSync(file.path, "utf8");
      if (content === "") {
        this.previewContent = [this.theme.fg("dim", "(empty file)")];
        return;
      }
      const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
      if (!lines.some((line) => line.trim().length > 0)) {
        this.previewContent = [this.theme.fg("dim", "(blank file)")];
        return;
      }
      this.previewContent = lines;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.previewContent = [
        this.theme.fg("error", `Cannot read ${file.name}`),
        "",
        this.theme.fg("dim", message),
      ];
    }
  }

  private loadGitPreview(file: FileEntry) {
    if (file.isDirectory) {
      this.loadFilePreview(file);
      return;
    }

    const repoPath = this.selectedRepoPath;
    const relPath = file.relativePath;
    if (!repoPath || !relPath) {
      this.previewContent = [this.theme.fg("error", "Repository context missing")];
      return;
    }

    if (file.untracked) {
      this.loadGitFilePreview(file, "Untracked file");
      return;
    }

    if (file.unstaged && this.loadGitDiffPreview(repoPath, relPath, "Unstaged changes", `git diff -- ${JSON.stringify(relPath)}`)) {
      return;
    }

    if (file.staged && this.loadGitDiffPreview(repoPath, relPath, "Staged changes", `git diff --cached -- ${JSON.stringify(relPath)}`)) {
      return;
    }

    const mergeBase = this.gitBaseRef ? this.getMergeBase(repoPath, this.gitBaseRef) : null;
    if (mergeBase && file.inBranchDiff && this.loadGitDiffPreview(
      repoPath,
      relPath,
      `Branch vs ${this.gitBaseRef}`,
      `git diff ${JSON.stringify(mergeBase)}...HEAD -- ${JSON.stringify(relPath)}`,
    )) {
      return;
    }

    this.loadGitFilePreview(file, "Current file");
  }

  private loadGitFilePreview(file: FileEntry, title: string) {
    this.loadFilePreview(file);
    this.previewContent = [this.theme.fg("accent", title), "", ...this.previewContent];
  }

  private loadGitDiffPreview(repoPath: string, relPath: string, title: string, gitDiffCommand: string): boolean {
    const result = this.runGitText(
      repoPath,
      `${gitDiffCommand} | delta --line-numbers 2>/dev/null || ${gitDiffCommand}`,
    );

    const lines = result.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const hasContent = lines.some((line) => line.length > 0);
    if (!hasContent) {
      return false;
    }

    this.previewContent = [
      this.theme.fg("accent", title),
      this.theme.fg("dim", relPath),
      "",
      ...lines,
    ];
    return true;
  }

  handleInput(data: string): void {
    if (this.closed) return;

    if (this.filterMode) {
      this.handleFilterInput(data);
      return;
    }

    if (matchesKey(data, "escape")) {
      this.close();
      return;
    }

    if (data === "/") {
      this.enterFilterMode();
      return;
    }

    if (data === "t" || data === "T") {
      this.switchMode("tree");
      return;
    }

    if (data === "g" || data === "G") {
      this.switchMode("git");
      return;
    }

    if (this.mode === "git" && this.gitSubmode === "repo-tree") {
      if (data === "a" || data === "A") {
        this.gitTreeScope = "all";
        this.loadFiles();
        return;
      }
      if (data === "c" || data === "C") {
        this.gitTreeScope = "changes";
        this.loadFiles();
        return;
      }
      if (data === "r" || data === "R") {
        this.leaveRepo();
        return;
      }
    }

    if (matchesKey(data, "tab")) {
      this.focusedPane = this.focusedPane === "left" ? "right" : "left";
      this.tui.requestRender();
      return;
    }

    if (this.focusedPane === "left") {
      this.handleLeftPaneInput(data);
    } else {
      this.handleRightPaneInput(data);
    }
  }

  private handleFilterInput(data: string) {
    this.filterInput.handleInput(data);
    const nextQuery = this.filterInput.getValue();
    if (nextQuery === this.filterQuery) {
      this.tui.requestRender();
      return;
    }

    this.filterQuery = nextQuery;
    this.refreshVisibleFiles();
    this.loadPreview();
  }

  private enterFilterMode() {
    this.filterMode = true;
    this.filterInput.setValue(this.filterQuery);
    this.tui.requestRender();
  }

  private exitFilterMode(clear: boolean) {
    this.filterMode = false;
    if (clear) {
      this.filterQuery = "";
      this.filterInput.setValue("");
      this.refreshVisibleFiles();
      this.loadPreview();
      return;
    }
    this.tui.requestRender();
  }

  private clearFilter() {
    this.filterQuery = "";
    this.filterInput.setValue("");
    this.filterMode = false;
  }

  private switchMode(mode: FileViewMode) {
    if (this.mode === mode) return;
    this.saveCurrentPreviewScroll();
    this.mode = mode;
    this.focusedPane = "left";
    this.clearFilter();
    this.onModeChange(mode);

    if (mode === "tree") {
      this.currentDir = this.cwd;
    } else if (this.selectedRepoPath && this.isRepoDirectory(this.selectedRepoPath)) {
      this.gitSubmode = "repo-tree";
      this.currentDir = this.isPathInside(this.selectedRepoPath, this.currentDir) ? this.currentDir : this.selectedRepoPath;
      this.gitBaseRef = this.detectBaseRef(this.selectedRepoPath);
    } else {
      this.gitSubmode = "repo-picker";
      this.selectedRepoPath = null;
      this.currentDir = this.cwd;
    }

    this.loadFiles();
  }

  private leaveRepo() {
    this.saveCurrentPreviewScroll();
    this.gitSubmode = "repo-picker";
    this.currentDir = this.cwd;
    this.selectedPath = this.selectedRepoPath;
    this.focusedPane = "left";
    this.clearFilter();
    this.loadFiles();
  }

  private enterRepo(repoPath: string) {
    this.saveCurrentPreviewScroll();
    this.selectedRepoPath = repoPath;
    this.gitSubmode = "repo-tree";
    this.gitTreeScope = "changes";
    this.gitBaseRef = this.detectBaseRef(repoPath);
    this.currentDir = repoPath;
    this.selectedPath = null;
    this.focusedPane = "left";
    this.clearFilter();
    this.loadFiles();
  }

  private navigateUp() {
    const file = this.selectedFile();
    if (file?.name === "..") {
      this.navigateInto();
      return;
    }

    if (this.mode === "tree") {
      const parentDir = dirname(this.currentDir);
      if (parentDir !== this.currentDir) {
        this.currentDir = parentDir;
        this.selectedPath = parentDir;
        this.loadFiles();
      }
      return;
    }

    if (this.gitSubmode === "repo-tree" && this.selectedRepoPath && this.currentDir !== this.selectedRepoPath) {
      this.currentDir = dirname(this.currentDir);
      this.selectedPath = this.currentDir;
      this.loadFiles();
    }
  }

  private navigateInto() {
    const file = this.selectedFile();
    if (!file) return;

    if (this.mode === "git" && this.gitSubmode === "repo-picker" && file.isRepo) {
      this.enterRepo(file.path);
      return;
    }

    if (!file.isDirectory) {
      return;
    }

    this.saveCurrentPreviewScroll();
    this.currentDir = file.path;
    this.selectedPath = null;
    this.loadFiles();
  }

  private selectIndex(nextIndex: number) {
    if (this.visibleFiles.length === 0) {
      return;
    }

    const clamped = Math.max(0, Math.min(this.visibleFiles.length - 1, nextIndex));
    if (clamped === this.selectedIndex) {
      return;
    }

    this.saveCurrentPreviewScroll();
    this.selectedIndex = clamped;
    this.selectedPath = this.visibleFiles[this.selectedIndex]?.path ?? null;
    this.loadPreview();
    this.adjustLeftScroll();
  }

  private handleLeftPaneInput(data: string) {
    if (this.visibleFiles.length === 0) {
      return;
    }

    const count = this.visibleFiles.length;
    if (matchesKey(data, "up")) {
      const next = this.selectedIndex === 0 ? count - 1 : this.selectedIndex - 1;
      this.selectIndex(next);
    } else if (matchesKey(data, "down")) {
      const next = this.selectedIndex === count - 1 ? 0 : this.selectedIndex + 1;
      this.selectIndex(next);
    } else if (matchesKey(data, "pageUp")) {
      this.selectIndex(Math.max(0, this.selectedIndex - (this.contentHeight || 10)));
    } else if (matchesKey(data, "pageDown")) {
      this.selectIndex(Math.min(count - 1, this.selectedIndex + (this.contentHeight || 10)));
    } else if (matchesKey(data, "home")) {
      this.selectIndex(0);
    } else if (matchesKey(data, "end")) {
      this.selectIndex(count - 1);
    } else if (matchesKey(data, "return")) {
      this.navigateInto();
    } else if (matchesKey(data, "left") || matchesKey(data, "backspace") || data === "h" || data === "H") {
      this.navigateUp();
    } else if (matchesKey(data, "right") || data === "l" || data === "L") {
      this.navigateInto();
    }
  }

  private handleRightPaneInput(data: string) {
    const viewportHeight = this.contentHeight || 20;
    if (matchesKey(data, "up")) {
      this.scrollRightBy(-1);
    } else if (matchesKey(data, "down")) {
      this.scrollRightBy(1);
    } else if (matchesKey(data, "pageUp")) {
      this.scrollRightBy(-viewportHeight);
    } else if (matchesKey(data, "pageDown")) {
      this.scrollRightBy(viewportHeight);
    } else if (matchesKey(data, "home") || matchesKey(data, "ctrl+a")) {
      this.scrollRightTo(0);
    } else if (matchesKey(data, "end") || matchesKey(data, "ctrl+e")) {
      this.scrollRightTo(this.maxRightScroll());
    } else if (matchesKey(data, "ctrl+u")) {
      this.scrollRightBy(-Math.max(1, Math.floor(viewportHeight / 2)));
    } else if (matchesKey(data, "ctrl+d")) {
      this.scrollRightBy(Math.max(1, Math.floor(viewportHeight / 2)));
    }
  }

  private adjustLeftScroll() {
    const contentHeight = this.contentHeight || 20;
    if (this.selectedIndex < this.leftScroll) {
      this.leftScroll = this.selectedIndex;
    } else if (this.selectedIndex >= this.leftScroll + contentHeight) {
      this.leftScroll = this.selectedIndex - contentHeight + 1;
    }
    this.leftScroll = Math.max(0, this.leftScroll);
    this.tui.requestRender();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onClose(this.snapshotState());
  }

  render(width: number): string[] {
    const dialogWidth = Math.max(40, width);
    const innerWidth = dialogWidth - 2;
    const leftWidth = Math.floor(innerWidth * 0.35);
    const rightWidth = innerWidth - leftWidth - 1;
    const rows = process.stdout.rows ?? 30;
    const showFilter = this.filterMode || this.filterQuery.length > 0;
    const chromeLines = showFilter ? 7 : 6;
    const dialogHeight = Math.max(12, Math.min(rows - 2, Math.floor(rows * 0.94)));
    const contentHeight = Math.max(4, dialogHeight - chromeLines);
    this.contentHeight = contentHeight;

    if (this.markdownPreview && this.markdownPreviewWidth !== rightWidth) {
      const file = this.selectedFile();
      this.renderMarkdownPreview(rightWidth, file?.name ?? "markdown file");
      this.restorePreviewScroll(file?.path ?? null);
    }

    const lines: string[] = [];
    const th = this.theme;

    lines.push(th.fg("borderMuted", `┌${"─".repeat(innerWidth)}┐`));

    const modeLabel = this.mode === "tree"
      ? "Tree"
      : this.gitSubmode === "repo-picker"
        ? "Git repos"
        : `Git ${this.gitTreeScope}`;
    const location = this.mode === "tree"
      ? this.currentDir
      : this.gitSubmode === "repo-picker"
        ? this.cwd
        : this.currentDir;
    const baseLabel = this.mode === "git" && this.gitSubmode === "repo-tree" && this.gitBaseRef
      ? ` vs ${this.gitBaseRef}`
      : "";
    const headerText = truncateToWidth(` ${modeLabel}${baseLabel} · ${location} `, innerWidth - 2);
    const header = th.fg("accent", th.bold(headerText));
    const headerPad = Math.max(0, innerWidth - visibleWidth(header));
    lines.push(`${th.fg("borderMuted", "│")}${header}${" ".repeat(headerPad)}${th.fg("borderMuted", "│")}`);

    if (showFilter) {
      const filterContent = this.filterMode
        ? `/${this.filterInput.render(Math.max(1, innerWidth - 1))[0] ?? ""}`
        : this.theme.fg("dim", truncateToWidth(`/${this.filterQuery}`, innerWidth));
      const filterLine = truncateToWidth(filterContent, innerWidth);
      const filterPad = Math.max(0, innerWidth - visibleWidth(filterLine));
      lines.push(`${th.fg("borderMuted", "│")}${filterLine}${" ".repeat(filterPad)}${th.fg("borderMuted", "│")}`);
    }

    const sepMid = this.focusedPane === "right" ? th.fg("accent", "┬") : th.fg("borderMuted", "┬");
    lines.push(th.fg("borderMuted", `├${"─".repeat(leftWidth)}`) + sepMid + th.fg("borderMuted", `${"─".repeat(rightWidth)}┤`));

    for (let row = 0; row < contentHeight; row++) {
      const leftLine = this.renderLeftLine(row, leftWidth, contentHeight);
      const rightLine = this.renderRightLine(row, rightWidth, contentHeight);
      const paneDivider = this.focusedPane === "right" ? th.fg("accent", "│") : th.fg("borderMuted", "│");
      lines.push(`${th.fg("borderMuted", "│")}${leftLine}${paneDivider}${rightLine}${th.fg("borderMuted", "│")}`);
    }

    const botMid = this.focusedPane === "right" ? th.fg("accent", "┴") : th.fg("borderMuted", "┴");
    lines.push(th.fg("borderMuted", `├${"─".repeat(leftWidth)}`) + botMid + th.fg("borderMuted", `${"─".repeat(rightWidth)}┤`));

    let hints = this.mode === "tree"
      ? " ↑↓ wrap · PgUp/PgDn fast nav · Enter/l open · h/← up · / filter · Tab pane · Esc close "
      : this.gitSubmode === "repo-picker"
        ? " ↑↓ wrap · Enter open repo · / filter · Tab pane · t tree · Esc close "
        : " ↑↓ wrap · PgUp/PgDn/Home/End scroll · Ctrl+U/D half-page · a all · c changes · r repos · / filter ";
    const footer = th.fg("dim", truncateToWidth(hints, innerWidth));
    const footerPad = Math.max(0, innerWidth - visibleWidth(footer));
    lines.push(`${th.fg("borderMuted", "│")}${footer}${" ".repeat(footerPad)}${th.fg("borderMuted", "│")}`);
    lines.push(th.fg("borderMuted", `└${"─".repeat(innerWidth)}┘`));

    return lines;
  }

  private renderLeftLine(row: number, width: number, contentHeight: number): string {
    if (this.visibleFiles.length === 0) {
      const msg = this.mode === "git"
        ? this.gitSubmode === "repo-picker"
          ? "No repositories found"
          : this.gitTreeScope === "changes"
            ? "No changed files"
            : "Empty directory"
        : "Empty directory";
      if (row === Math.floor(contentHeight / 2)) {
        return this.center(this.theme.fg("dim", truncateToWidth(msg, width)), width);
      }
      return " ".repeat(width);
    }

    const fileIndex = this.leftScroll + row;
    const file = this.visibleFiles[fileIndex];
    if (!file) return " ".repeat(width);

    const isSelected = fileIndex === this.selectedIndex;
    const isFocused = isSelected && this.focusedPane === "left";
    const prefix = this.leftPrefix(file);
    const maxNameWidth = Math.max(1, width - visibleWidth(prefix));

    let name = file.name;
    if (visibleWidth(name) > maxNameWidth) {
      name = truncateToWidth(name, Math.max(1, maxNameWidth - 3)) + "...";
    }

    let styledName = name;
    if (file.isRepo) {
      styledName = this.theme.fg("accent", name);
    } else if (file.isDirectory && file.name !== "..") {
      styledName = this.theme.fg("accent", name);
    }

    let text = `${prefix}${styledName}`;
    const padding = width - visibleWidth(text);
    if (isFocused) {
      text = this.theme.bg("selectedBg", this.theme.fg("accent", text));
    } else if (isSelected) {
      text = this.theme.bg("selectedBg", this.theme.fg("text", text));
    }

    return text + " ".repeat(Math.max(0, padding));
  }

  private leftPrefix(file: FileEntry): string {
    if (this.mode === "tree") {
      if (file.isDirectory && file.name !== "..") return "+ ";
      return "  ";
    }

    if (this.gitSubmode === "repo-picker") {
      return "@ ";
    }

    if (file.name === "..") {
      return "  ";
    }

    const badges: string[] = [];
    if (file.inBranchDiff) badges.push("B");
    if (file.staged) badges.push("S");
    if (file.unstaged) badges.push("U");
    if (file.untracked) badges.push("?");
    const status = badges.length > 0 ? `[${badges.join("")}] ` : "    ";
    const kind = file.isDirectory ? "+ " : "  ";
    return `${status}${kind}`;
  }

  private renderRightLine(row: number, width: number, _contentHeight: number): string {
    const lineIndex = this.rightScroll + row;
    const line = this.previewContent[lineIndex];
    if (line === undefined) {
      return " ".repeat(width);
    }

    let display = truncateToWidth(line, width);
    if (visibleWidth(display) < width) {
      display += " ".repeat(width - visibleWidth(display));
    }
    return display;
  }

  private center(text: string, width: number): string {
    const vis = visibleWidth(text);
    const pad = Math.max(0, width - vis);
    const leftPad = Math.floor(pad / 2);
    return " ".repeat(leftPad) + text + " ".repeat(pad - leftPad);
  }

  invalidate(): void {
    this.tui.requestRender();
  }

  dispose(): void {
    this.close();
  }
}
