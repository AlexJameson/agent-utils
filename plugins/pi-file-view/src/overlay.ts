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
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

import type { DiffLayout, FileEntry, FileViewMode, GitSubmode, GitTreeScope, MarkdownPreviewMode, OverlaySessionState } from "./types.js";

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

interface DiffPreviewState {
  title: string;
  relPath: string;
  rawDiff: string;
}

interface WrappedPreviewState {
  lines: string[];
  wrap: boolean;
  lineNumbers: Array<string | null>;
}

interface RenderedPreview {
  lines: string[];
  lineNumbers: Array<string | null>;
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
  private diffLayout: DiffLayout = "side-by-side";
  private markdownPreviewMode: MarkdownPreviewMode = "rendered";
  private leftScroll = 0;
  private rightScroll = 0;
  private selectedIndex = 0;
  private selectedPath: string | null = null;
  private allFiles: FileEntry[] = [];
  private visibleFiles: FileEntry[] = [];
  private previewContent: string[] = [];
  private previewLineNumbers: Array<string | null> = [];
  private previewLineNumberWidth = 0;
  private textPreview: WrappedPreviewState | null = null;
  private textPreviewWidth = 0;
  private filterInput: Input | null = null;
  private filterMode = false;
  private filterQuery = "";
  private markdownPreview: Markdown | null = null;
  private markdownPreviewWidth = 0;
  private diffPreview: DiffPreviewState | null = null;
  private diffPreviewWidth = 0;
  private rightScrollByPath: Record<string, number> = {};
  private closed = false;
  private contentHeight = 0;
  private showLineNumbers = false;

  private currentDir: string;

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
    this.diffLayout = initialState?.diffLayout ?? "side-by-side";
    this.markdownPreviewMode = initialState?.markdownPreviewMode ?? "rendered";
    this.currentDir = initialState?.currentDir ?? options.cwd;
    this.leftScroll = initialState?.leftScroll ?? 0;
    this.selectedPath = initialState?.selectedPath ?? null;
    this.selectedRepoPath = initialState?.selectedRepoPath ?? null;
    this.gitSubmode = initialState?.gitSubmode ?? "repo-picker";
    this.gitTreeScope = initialState?.gitTreeScope ?? "changes";
    this.gitBaseRef = initialState?.gitBaseRef ?? null;
    this.rightScrollByPath = { ...(initialState?.rightScrollByPath ?? {}) };

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
      diffLayout: this.diffLayout,
      markdownPreviewMode: this.markdownPreviewMode,
      currentDir: this.currentDir,
      selectedPath: this.selectedPath ?? this.selectedFile()?.path ?? null,
      leftScroll: this.leftScroll,
      selectedRepoPath: this.selectedRepoPath,
      gitSubmode: this.gitSubmode,
      gitTreeScope: this.gitTreeScope,
      gitBaseRef: this.gitBaseRef,
      rightScrollByPath: { ...this.rightScrollByPath },
    };
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
      const lines = this.markdownPreview?.render(Math.max(1, width)) ?? [];
      this.setRenderedPreview(lines);
      this.markdownPreviewWidth = Math.max(1, width);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.markdownPreview = null;
      this.markdownPreviewWidth = 0;
      this.setTextPreview([
        this.theme.fg("error", `Cannot render ${fileName}`),
        "",
        this.theme.fg("dim", message),
      ]);
    }
  }

  private setRenderedPreview(lines: string[], lineNumbers?: Array<string | null>) {
    this.previewContent = lines;
    this.previewLineNumbers = lineNumbers ?? Array.from({ length: lines.length }, () => null);
    const widths = this.previewLineNumbers
      .filter((value): value is string => value !== null)
      .map((value) => value.length);
    this.previewLineNumberWidth = widths.length > 0 ? Math.max(...widths) : 0;
    this.showLineNumbers = this.previewLineNumberWidth > 0;
  }

  private setTextPreview(lines: string[], options: { wrap?: boolean; lineNumbers?: Array<string | null> } = {}) {
    this.textPreview = {
      lines,
      wrap: options.wrap ?? true,
      lineNumbers: options.lineNumbers ?? Array.from({ length: lines.length }, () => null),
    };
    this.renderTextPreview(1);
  }

  private renderTextPreview(width: number) {
    if (!this.textPreview) {
      return;
    }

    const targetWidth = Math.max(1, width);
    const labelWidth = Math.max(
      0,
      ...this.textPreview.lineNumbers.filter((value): value is string => value !== null).map((value) => value.length),
    );
    const contentWidth = Math.max(1, targetWidth - (labelWidth > 0 ? labelWidth + 3 : 0));
    const rendered: string[] = [];
    const renderedLineNumbers: Array<string | null> = [];

    for (let index = 0; index < this.textPreview.lines.length; index++) {
      const line = this.textPreview.lines[index];
      const lineNumber = this.textPreview.lineNumbers[index] ?? null;
      const wrapped = this.textPreview.wrap ? wrapTextWithAnsi(line, contentWidth) : [line];

      for (let chunkIndex = 0; chunkIndex < wrapped.length; chunkIndex++) {
        rendered.push(wrapped[chunkIndex] ?? "");
        renderedLineNumbers.push(chunkIndex === 0 ? lineNumber : null);
      }
    }

    this.setRenderedPreview(rendered, renderedLineNumbers);
    this.textPreviewWidth = targetWidth;
  }

  private renderDiffPreview(width: number) {
    if (!this.diffPreview) {
      return;
    }

    const targetWidth = Math.max(1, width);
    if (this.diffLayout === "side-by-side") {
      this.setRenderedPreview(this.buildSideBySideDiff(
        this.diffPreview.title,
        this.diffPreview.relPath,
        this.diffPreview.rawDiff,
        targetWidth,
      ));
    } else {
      const rendered = this.buildUnifiedDiff(
        this.diffPreview.title,
        this.diffPreview.relPath,
        this.diffPreview.rawDiff,
        targetWidth,
      );
      this.setRenderedPreview(rendered.lines, rendered.lineNumbers);
    }
    this.diffPreviewWidth = Math.max(1, width);
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
    this.clearFilterState();

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
    this.visibleFiles = query
      ? this.allFiles.filter((file) => file.name.toLowerCase().includes(query))
      : [...this.allFiles];

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

    this.selectedIndex = savedIndex >= 0 ? savedIndex : 0;
    this.selectedPath = this.visibleFiles[this.selectedIndex]?.path ?? null;
    this.leftScroll = Math.max(0, Math.min(this.leftScroll, Math.max(0, this.visibleFiles.length - 1)));
    this.adjustLeftScroll();
  }

  private clearFilterState() {
    this.filterMode = false;
    this.filterQuery = "";
    if (this.filterInput) {
      this.filterInput.setValue("");
      this.filterInput.focused = false;
    }
  }

  private beginFilterMode() {
    this.focusedPane = "left";
    this.filterMode = true;
    if (!this.filterInput) {
      this.filterInput = new Input();
    }
    this.filterInput.setValue(this.filterQuery);
    this.filterInput.focused = true;
    this.tui.requestRender();
  }

  private endFilterMode(clearQuery: boolean) {
    this.filterMode = false;
    if (this.filterInput) {
      this.filterInput.focused = false;
    }
    if (clearQuery) {
      this.filterQuery = "";
      if (this.filterInput) {
        this.filterInput.setValue("");
      }
      this.refreshVisibleFiles();
      this.loadPreview();
    }
    this.tui.requestRender();
  }

  private handleFilterInput(data: string) {
    if (data === "\u001b" || matchesKey(data, "escape")) {
      this.endFilterMode(true);
      return;
    }

    if (matchesKey(data, "return")) {
      this.endFilterMode(false);
      return;
    }

    if (matchesKey(data, "up") || matchesKey(data, "down") || matchesKey(data, "pageUp") || matchesKey(data, "pageDown") || matchesKey(data, "home") || matchesKey(data, "end")) {
      this.endFilterMode(false);
      this.handleLeftPaneInput(data);
      return;
    }

    if (matchesKey(data, "tab")) {
      this.endFilterMode(false);
      this.focusedPane = "right";
      this.tui.requestRender();
      return;
    }

    if (!this.filterInput) {
      this.filterInput = new Input();
    }

    this.filterInput.handleInput(data);
    this.filterQuery = this.filterInput.getValue();
    this.refreshVisibleFiles();
    this.loadPreview();
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
    this.allFiles = this.discoverRepos(this.cwd, 4);
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
    this.textPreview = null;
    this.textPreviewWidth = 0;
    this.markdownPreview = null;
    this.markdownPreviewWidth = 0;
    this.diffPreview = null;
    this.diffPreviewWidth = 0;
    this.previewContent = [];
    this.previewLineNumbers = [];
    this.previewLineNumberWidth = 0;
    this.showLineNumbers = false;

    const file = this.selectedFile();
    if (!file) {
      this.setTextPreview([this.theme.fg("dim", "No file selected")]);
      this.restorePreviewScroll(null);
      this.tui.requestRender();
      return;
    }

    this.selectedPath = file.path;

    if (this.mode === "tree") {
      if (this.isMarkdownFile(file) && this.markdownPreviewMode === "rendered") {
        this.loadMarkdownPreview(file);
      } else {
        this.loadFilePreview(file);
      }
    } else if (this.gitSubmode === "repo-picker") {
      this.setTextPreview([
        this.theme.fg("accent", file.name),
        "",
        this.theme.fg("dim", file.path),
        "",
        this.theme.fg("dim", "Enter to open repository"),
      ]);
    } else {
      this.loadGitPreview(file);
    }

    this.restorePreviewScroll(file.path);
    this.tui.requestRender();
  }

  private isMarkdownFile(file: FileEntry | undefined): boolean {
    return Boolean(file && !file.isDirectory && file.name.endsWith(".md"));
  }

  private loadMarkdownPreview(file: FileEntry) {
    try {
      const content = readFileSync(file.path, "utf8");
      if (content === "") {
        this.setTextPreview([this.theme.fg("dim", "(empty file)")]);
        return;
      }

      const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      if (!normalized.split("\n").some((line) => line.trim().length > 0)) {
        this.setTextPreview([this.theme.fg("dim", "(blank file)")]);
        return;
      }

      this.markdownPreview = new Markdown(normalized, 0, 0, this.getMarkdownTheme(), {
        color: (text) => this.theme.fg("text", text),
      });
      this.renderMarkdownPreview(1, file.name);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setTextPreview([
        this.theme.fg("error", `Cannot read ${file.name}`),
        "",
        this.theme.fg("dim", message),
      ]);
    }
  }

  private loadFilePreview(file: FileEntry) {
    if (file.isDirectory) {
      if (file.name === "..") {
        this.setTextPreview([
          this.theme.fg("dim", "Parent directory"),
          "",
          this.theme.fg("accent", "Enter / h / ←") + this.theme.fg("dim", " to navigate"),
        ]);
      } else {
        this.setTextPreview([
          this.theme.fg("dim", `Directory: ${file.name}`),
          "",
          this.theme.fg("accent", "Enter / l / →") + this.theme.fg("dim", " to open"),
        ]);
      }
      return;
    }

    try {
      const content = readFileSync(file.path, "utf8");
      if (content === "") {
        this.setTextPreview([this.theme.fg("dim", "(empty file)")], { lineNumbers: ["1"] });
        return;
      }
      const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
      if (!lines.some((line) => line.trim().length > 0)) {
        this.setTextPreview([this.theme.fg("dim", "(blank file)")], { lineNumbers: ["1"] });
        return;
      }
      this.setTextPreview(lines, { lineNumbers: lines.map((_, index) => String(index + 1)) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setTextPreview([
        this.theme.fg("error", `Cannot read ${file.name}`),
        "",
        this.theme.fg("dim", message),
      ]);
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
      this.setTextPreview([this.theme.fg("error", "Repository context missing")]);
      return;
    }

    if (file.untracked) {
      this.loadGitFilePreview(file, "Untracked file");
      return;
    }

    if (file.unstaged && this.loadGitDiffPreview(repoPath, relPath, "Unstaged changes", `git diff --no-color --no-ext-diff -- ${JSON.stringify(relPath)}`)) {
      return;
    }

    if (file.staged && this.loadGitDiffPreview(repoPath, relPath, "Staged changes", `git diff --no-color --no-ext-diff --cached -- ${JSON.stringify(relPath)}`)) {
      return;
    }

    const mergeBase = this.gitBaseRef ? this.getMergeBase(repoPath, this.gitBaseRef) : null;
    if (mergeBase && file.inBranchDiff && this.loadGitDiffPreview(
      repoPath,
      relPath,
      `Branch vs ${this.gitBaseRef}`,
      `git diff --no-color --no-ext-diff ${JSON.stringify(mergeBase)}...HEAD -- ${JSON.stringify(relPath)}`,
    )) {
      return;
    }

    this.loadGitFilePreview(file, "Current file");
  }

  private loadGitFilePreview(file: FileEntry, title: string) {
    if (file.isDirectory) {
      this.loadFilePreview(file);
      return;
    }

    try {
      const content = readFileSync(file.path, "utf8");
      const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
      const body = content === ""
        ? [this.theme.fg("dim", "(empty file)")]
        : lines.some((line) => line.trim().length > 0)
          ? lines
          : [this.theme.fg("dim", "(blank file)")];
      this.setTextPreview(
        [this.theme.fg("accent", title), "", ...body],
        { lineNumbers: [null, null, ...body.map((_, index) => String(index + 1))] },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setTextPreview([
        this.theme.fg("accent", title),
        "",
        this.theme.fg("error", `Cannot read ${file.name}`),
        "",
        this.theme.fg("dim", message),
      ]);
    }
  }

  private loadGitDiffPreview(repoPath: string, relPath: string, title: string, gitDiffCommand: string): boolean {
    const result = this.runGitText(repoPath, gitDiffCommand);
    const normalized = result.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const lines = normalized.split("\n");
    const hasContent = lines.some((line) => line.length > 0);
    if (!hasContent) {
      return false;
    }

    this.diffPreview = {
      title,
      relPath,
      rawDiff: normalized,
    };
    this.renderDiffPreview(1);
    return true;
  }

  private wrapPrefixedLine(prefix: string, text: string, width: number): string[] {
    const prefixWidth = visibleWidth(prefix);
    const continuation = " ".repeat(prefixWidth);
    const wrapped = wrapTextWithAnsi(text, Math.max(1, width - prefixWidth));
    return wrapped.map((line, index) => `${index === 0 ? prefix : continuation}${line}`);
  }

  private padLine(text: string, width: number): string {
    const padding = width - visibleWidth(text);
    return text + " ".repeat(Math.max(0, padding));
  }

  private buildUnifiedDiff(title: string, relPath: string, rawDiff: string, width: number): RenderedPreview {
    const logicalLines: Array<{ text: string; lineNumber: string | null }> = [
      { text: this.theme.fg("accent", title), lineNumber: null },
      { text: this.theme.fg("dim", relPath), lineNumber: null },
      { text: "", lineNumber: null },
    ];
    let oldLine: number | null = null;
    let newLine: number | null = null;

    for (const line of rawDiff.split("\n")) {
      if (!line) {
        logicalLines.push({ text: "", lineNumber: null });
        continue;
      }

      if (line.startsWith("diff --git ") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
        continue;
      }

      if (line.startsWith("@@")) {
        const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        oldLine = hunk ? Number(hunk[1]) : null;
        newLine = hunk ? Number(hunk[2]) : null;
        logicalLines.push({ text: this.theme.fg("accent", line), lineNumber: null });
        continue;
      }

      if (line.startsWith("-")) {
        logicalLines.push({
          text: this.theme.fg("toolDiffRemoved", `- ${line.slice(1)}`),
          lineNumber: oldLine === null ? null : `${oldLine}/-`,
        });
        if (oldLine !== null) {
          oldLine += 1;
        }
        continue;
      }

      if (line.startsWith("+")) {
        logicalLines.push({
          text: this.theme.fg("toolDiffAdded", `+ ${line.slice(1)}`),
          lineNumber: newLine === null ? null : `-/${newLine}`,
        });
        if (newLine !== null) {
          newLine += 1;
        }
        continue;
      }

      const context = line.startsWith(" ") ? line.slice(1) : line;
      logicalLines.push({
        text: this.theme.fg("toolDiffContext", `  ${context}`),
        lineNumber: oldLine === null || newLine === null ? null : `${oldLine}/${newLine}`,
      });
      if (oldLine !== null) {
        oldLine += 1;
      }
      if (newLine !== null) {
        newLine += 1;
      }
    }

    const lineNumberWidth = Math.max(
      0,
      ...logicalLines.filter((item) => item.lineNumber !== null).map((item) => item.lineNumber?.length ?? 0),
    );
    const contentWidth = Math.max(1, width - (lineNumberWidth > 0 ? lineNumberWidth + 3 : 0));
    const lines: string[] = [];
    const lineNumbers: Array<string | null> = [];

    for (const logicalLine of logicalLines) {
      const wrapped = wrapTextWithAnsi(logicalLine.text, contentWidth);
      for (let chunkIndex = 0; chunkIndex < wrapped.length; chunkIndex++) {
        lines.push(wrapped[chunkIndex] ?? "");
        lineNumbers.push(chunkIndex === 0 ? logicalLine.lineNumber : null);
      }
    }

    return { lines, lineNumbers };
  }

  private buildSideBySideDiff(title: string, relPath: string, rawDiff: string, width: number): string[] {
    const lines: string[] = [
      ...wrapTextWithAnsi(this.theme.fg("accent", title), width),
      ...wrapTextWithAnsi(this.theme.fg("dim", relPath), width),
      "",
    ];

    const separator = this.theme.fg("borderMuted", " │ ");
    const separatorWidth = visibleWidth(separator);
    const columnWidth = Math.max(8, Math.floor((width - separatorWidth) / 2));
    const pendingRemoved: string[] = [];
    const pendingAdded: string[] = [];

    const flushPending = () => {
      const pairCount = Math.max(pendingRemoved.length, pendingAdded.length);
      for (let i = 0; i < pairCount; i++) {
        const left = pendingRemoved[i] ?? "";
        const right = pendingAdded[i] ?? "";
        const leftChunks = left ? this.wrapPrefixedLine("- ", left, columnWidth) : [""];
        const rightChunks = right ? this.wrapPrefixedLine("+ ", right, columnWidth) : [""];
        const rowCount = Math.max(leftChunks.length, rightChunks.length);

        for (let row = 0; row < rowCount; row++) {
          const leftChunk = leftChunks[row] ?? "";
          const rightChunk = rightChunks[row] ?? "";
          const leftText = leftChunk
            ? this.theme.fg("toolDiffRemoved", this.padLine(leftChunk, columnWidth))
            : " ".repeat(columnWidth);
          const rightText = rightChunk
            ? this.theme.fg("toolDiffAdded", this.padLine(rightChunk, columnWidth))
            : " ".repeat(columnWidth);
          lines.push(`${leftText}${separator}${rightText}`);
        }
      }
      pendingRemoved.length = 0;
      pendingAdded.length = 0;
    };

    for (const line of rawDiff.split("\n")) {
      if (!line) {
        flushPending();
        lines.push("");
        continue;
      }

      if (line.startsWith("diff --git ") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
        continue;
      }

      if (line.startsWith("@@")) {
        flushPending();
        lines.push(...wrapTextWithAnsi(this.theme.fg("accent", line), width).map((item) => this.padLine(item, width)));
        continue;
      }

      if (line.startsWith("-")) {
        pendingRemoved.push(line.slice(1));
        continue;
      }

      if (line.startsWith("+")) {
        pendingAdded.push(line.slice(1));
        continue;
      }

      flushPending();
      const context = line.startsWith(" ") ? line.slice(1) : line;
      lines.push(...this.wrapPrefixedLine("  ", context, width).map((item) => this.theme.fg("toolDiffContext", this.padLine(item, width))));
    }

    flushPending();
    return lines;
  }

  handleInput(data: string): void {
    if (this.closed) return;

    if (this.filterMode) {
      this.handleFilterInput(data);
      return;
    }

    if (data === "\u001b") {
      this.close();
      return;
    }

    if (matchesKey(data, "escape")) {
      this.close();
      return;
    }

    if (data === "t" || data === "T") {
      this.switchMode("tree");
      return;
    }

    if (data === "/") {
      this.beginFilterMode();
      return;
    }

    if (this.mode === "tree" && (data === "v" || data === "V") && this.isMarkdownFile(this.selectedFile())) {
      this.toggleMarkdownPreviewMode();
      return;
    }

    if (this.mode === "git" && this.gitSubmode === "repo-tree" && (data === "v" || data === "V")) {
      this.toggleDiffLayout();
      return;
    }

    if (data === "g" || data === "G") {
      this.switchMode("git");
      return;
    }

    if (this.mode === "git" && (data === "r" || data === "R")) {
      this.toggleRepoTree();
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

  private switchMode(mode: FileViewMode) {
    if (this.mode === mode) return;
    this.saveCurrentPreviewScroll();
    this.mode = mode;
    this.focusedPane = "left";
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

  private toggleDiffLayout() {
    this.diffLayout = this.diffLayout === "side-by-side" ? "unified" : "side-by-side";
    if (this.diffPreview) {
      this.renderDiffPreview(this.diffPreviewWidth || 1);
      this.restorePreviewScroll(this.selectedFile()?.path ?? null);
    }
    this.tui.requestRender();
  }

  private toggleMarkdownPreviewMode() {
    if (this.mode !== "tree" || !this.isMarkdownFile(this.selectedFile())) {
      return;
    }

    this.saveCurrentPreviewScroll();
    this.markdownPreviewMode = this.markdownPreviewMode === "rendered" ? "raw" : "rendered";
    this.loadPreview();
  }

  private toggleRepoTree() {
    if (this.gitSubmode === "repo-tree") {
      this.leaveRepo();
      return;
    }

    const selectedRepo = this.selectedFile();
    const repoPath = selectedRepo?.isRepo ? selectedRepo.path : this.selectedRepoPath;
    if (repoPath && this.isRepoDirectory(repoPath)) {
      this.enterRepo(repoPath);
    }
  }

  private leaveRepo() {
    this.saveCurrentPreviewScroll();
    this.gitSubmode = "repo-picker";
    this.currentDir = this.cwd;
    this.selectedPath = this.selectedRepoPath;
    this.focusedPane = "left";
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
    const lineStep = 3;
    const pageStep = Math.max(1, viewportHeight * 2);
    if (matchesKey(data, "up")) {
      this.scrollRightBy(-lineStep);
    } else if (matchesKey(data, "down")) {
      this.scrollRightBy(lineStep);
    } else if (matchesKey(data, "pageUp")) {
      this.scrollRightBy(-pageStep);
    } else if (matchesKey(data, "pageDown")) {
      this.scrollRightBy(pageStep);
    } else if (matchesKey(data, "home") || matchesKey(data, "ctrl+a")) {
      this.scrollRightTo(0);
    } else if (matchesKey(data, "end") || matchesKey(data, "ctrl+e")) {
      this.scrollRightTo(this.maxRightScroll());
    } else if (matchesKey(data, "ctrl+u")) {
      this.scrollRightBy(-pageStep);
    } else if (matchesKey(data, "ctrl+d")) {
      this.scrollRightBy(pageStep);
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
    const splitLeftWidth = Math.floor(innerWidth * 0.30);
    const splitRightWidth = innerWidth - splitLeftWidth - 1;
    const leftWidth = splitLeftWidth;
    const rightWidth = splitRightWidth;
    const rows = process.stdout.rows ?? 30;
    const dialogHeight = Math.max(1, rows);
    const showFilter = this.filterMode || this.filterQuery.length > 0;
    const contentHeight = Math.max(1, dialogHeight - (showFilter ? 7 : 6));
    this.contentHeight = contentHeight;

    if (this.textPreview && this.textPreviewWidth !== rightWidth) {
      const file = this.selectedFile();
      this.renderTextPreview(rightWidth);
      this.restorePreviewScroll(file?.path ?? null);
    }

    if (this.markdownPreview && this.markdownPreviewWidth !== rightWidth) {
      const file = this.selectedFile();
      this.renderMarkdownPreview(rightWidth, file?.name ?? "markdown file");
      this.restorePreviewScroll(file?.path ?? null);
    }

    if (this.diffPreview && this.diffPreviewWidth !== rightWidth) {
      const file = this.selectedFile();
      this.renderDiffPreview(rightWidth);
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
      const filterInnerWidth = Math.max(1, innerWidth - 2);
      const activeLine = this.filterMode && this.filterInput
        ? this.filterInput.render(filterInnerWidth + 2)[0]?.slice(2) ?? ""
        : truncateToWidth(this.filterQuery, filterInnerWidth);
      const filterText = `${th.fg("accent", "/ ")}${activeLine}`;
      const filterPad = Math.max(0, innerWidth - visibleWidth(filterText));
      lines.push(`${th.fg("borderMuted", "│")}${filterText}${" ".repeat(filterPad)}${th.fg("borderMuted", "│")}`);
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

    let hints = this.filterMode
      ? " type to filter · Enter keep · Esc clear · ↑↓ browse · Tab pane "
      : this.mode === "tree"
      ? this.isMarkdownFile(this.selectedFile())
        ? ` ↑↓ wrap · PgUp/PgDn · / filter · v ${this.markdownPreviewMode === "rendered" ? "raw" : "rendered"} · Tab pane · g git · Esc close `
        : " ↑↓ wrap · PgUp/PgDn · / filter · Tab pane · g git · Esc close "
      : this.gitSubmode === "repo-picker"
        ? " ↑↓ wrap · / filter · Enter/r open repo · Tab pane · t tree · Esc close "
        : ` ↑↓ · PgUp/PgDn · Ctrl+U/D · / filter · a all · c changes · r repos · v ${this.diffLayout === "side-by-side" ? "unified" : "side-by-side"} · Tab pane · Esc close `;
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

  private getLineNumberPrefix(lineIndex: number): string {
    if (!this.showLineNumbers) return "";
    const label = this.previewLineNumbers[lineIndex];
    const padded = (label ?? "").padStart(this.previewLineNumberWidth, " ");
    return this.theme.fg("dim", `${padded} │ `);
  }

  private renderRightLine(row: number, width: number, _contentHeight: number): string {
    const lineIndex = this.rightScroll + row;
    const line = this.previewContent[lineIndex];
    if (line === undefined) {
      return " ".repeat(width);
    }

    const prefix = this.getLineNumberPrefix(lineIndex);
    const prefixWidth = visibleWidth(prefix);
    const contentWidth = Math.max(0, width - prefixWidth);

    let display = truncateToWidth(line, contentWidth);
    if (visibleWidth(display) < contentWidth) {
      display += " ".repeat(contentWidth - visibleWidth(display));
    }
    return prefix + display;
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
