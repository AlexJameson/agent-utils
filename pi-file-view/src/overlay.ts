import type { Theme } from "@earendil-works/pi-coding-agent";
import {
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
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";

import type { FileViewMode, FileEntry } from "./types.js";

interface FileViewOptions {
  tui: TUI;
  theme: Theme;
  keybindings: KeybindingsManager;
  cwd: string;
  initialMode: FileViewMode;
  onClose: () => void;
  onModeChange: (mode: FileViewMode) => void;
}

export class FileViewOverlay implements Focusable {
  private tui: TUI;
  private theme: Theme;
  private keybindings: KeybindingsManager;
  private cwd: string;
  private onClose: () => void;
  private onModeChange: (mode: FileViewMode) => void;

  private mode: FileViewMode;
  private focusedPane: "left" | "right" = "left";
  private leftScroll = 0;
  private rightScroll = 0;
  private selectedIndex = 0;
  private files: FileEntry[] = [];
  private previewContent: string[] = [];
  private markdownPreview: Markdown | null = null;
  private markdownPreviewWidth = 0;
  private isGitRepo = false;
  private closed = false;
  private contentHeight = 0;

  // Tree mode: current directory being browsed
  private currentDir: string;

  focused = false;

  constructor(options: FileViewOptions) {
    this.tui = options.tui;
    this.theme = options.theme;
    this.keybindings = options.keybindings;
    this.cwd = options.cwd;
    this.currentDir = options.cwd;
    this.onClose = options.onClose;
    this.onModeChange = options.onModeChange;
    this.mode = options.initialMode;

    this.checkGitRepo();
    this.loadFiles();
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
      this.previewContent = this.markdownPreview.render(width);
      this.markdownPreviewWidth = width;
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

  private checkGitRepo() {
    try {
      execSync("git rev-parse --git-dir", { cwd: this.cwd, stdio: "pipe" });
      this.isGitRepo = true;
    } catch {
      this.isGitRepo = false;
    }
  }

  private loadFiles() {
    if (this.mode === "tree") {
      this.loadTreeFiles();
    } else {
      this.loadGitFiles();
    }
    this.selectedIndex = 0;
    this.leftScroll = 0;
    this.loadPreview();
    this.tui.requestRender();
  }

  private loadTreeFiles() {
    this.files = [];

    // Add ".." if not at root
    const parentDir = dirname(this.currentDir);
    if (parentDir !== this.currentDir) {
      this.files.push({
        path: parentDir,
        name: "..",
        isDirectory: true,
      });
    }

    try {
      const entries = readdirSync(this.currentDir, { withFileTypes: true });
      // Sort: directories first, then files, both alphabetically
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

      this.files.push(...dirs, ...files);
    } catch {
      // Empty directory or permission error
    }
  }

  private loadGitFiles() {
    this.files = [];
    if (!this.isGitRepo) {
      return;
    }

    try {
      const result = execSync("git status --porcelain", {
        cwd: this.cwd,
        stdio: "pipe",
        encoding: "utf8",
      });
      const lines = result.trim().split("\n").filter(Boolean);
      for (const line of lines) {
        const status = line.slice(0, 2);
        const filePath = line.slice(3);
        this.files.push({
          path: join(this.cwd, filePath),
          name: filePath,
          isDirectory: false,
          gitStatus: status,
        });
      }
    } catch {
      // Empty
    }
  }

  private loadPreview() {
    this.markdownPreview = null;
    this.markdownPreviewWidth = 0;
    this.previewContent = [];
    const file = this.files[this.selectedIndex];
    if (!file) {
      this.previewContent = [this.theme.fg("dim", "No file selected")];
      this.tui.requestRender();
      return;
    }

    if (this.mode === "tree") {
      if (file.name.endsWith(".md")) {
        this.loadMarkdownPreview(file);
      } else {
        this.loadFilePreview(file);
      }
    } else {
      this.loadGitDiff(file);
    }
    this.rightScroll = 0;
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
          this.theme.fg("accent", "← h / ← ") + this.theme.fg("dim", "to navigate up"),
        ];
      } else {
        this.previewContent = [
          this.theme.fg("dim", `Directory: ${file.name}`),
          "",
          this.theme.fg("accent", "→ Enter / l / → ") + this.theme.fg("dim", "to open"),
        ];
      }
      return;
    }

    // Reliable file reading via Node.js (no shell/escaping/PATH issues)
    try {
      const content = readFileSync(file.path, "utf8");
      if (content === "") {
        this.previewContent = [this.theme.fg("dim", "(empty file)")];
        return;
      }
      const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
      // Safety: if every line is empty/whitespace, show a message
      const hasContent = lines.some((l) => l.trim().length > 0);
      if (!hasContent) {
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

  private loadGitDiff(file: FileEntry) {
    if (!this.isGitRepo) {
      this.previewContent = [this.theme.fg("error", "Not a git repository")];
      return;
    }

    const relPath = relative(this.cwd, file.path);

    // Try delta first
    try {
      const safePath = JSON.stringify(relPath);
      const result = execSync(`git diff ${safePath} | delta --line-numbers 2>/dev/null || git diff ${safePath}`, {
        cwd: this.cwd,
        stdio: "pipe",
        encoding: "utf8",
        timeout: 10000,
      });
      this.previewContent = result.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
      if (this.previewContent.length === 0 || (this.previewContent.length === 1 && this.previewContent[0] === "")) {
        this.previewContent = [this.theme.fg("dim", "No changes")];
      }
    } catch {
      this.previewContent = [this.theme.fg("error", `Cannot diff: ${file.name}`)];
    }
  }

  handleInput(data: string): void {
    if (this.closed) return;

    if (matchesKey(data, "escape")) {
      this.close();
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
    this.mode = mode;
    this.onModeChange(mode);
    // Reset current dir when switching to tree
    if (mode === "tree") {
      this.currentDir = this.cwd;
    }
    this.loadFiles();
  }

  private navigateUp() {
    if (this.mode !== "tree") return;
    const parentDir = dirname(this.currentDir);
    if (parentDir !== this.currentDir) {
      this.currentDir = parentDir;
      this.loadFiles();
    }
  }

  private navigateInto() {
    if (this.mode !== "tree") return;
    const file = this.files[this.selectedIndex];
    if (file?.isDirectory) {
      this.currentDir = file.path;
      this.loadFiles();
    }
  }

  private handleLeftPaneInput(data: string) {
    if (matchesKey(data, "up")) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.loadPreview();
    } else if (matchesKey(data, "down")) {
      if (this.files.length > 0) {
        this.selectedIndex = Math.min(this.files.length - 1, this.selectedIndex + 1);
        this.loadPreview();
      }
    } else if (matchesKey(data, "return")) {
      if (this.mode === "tree") {
        this.navigateInto();
      }
    } else if (matchesKey(data, "left") || matchesKey(data, "backspace") || data === "h" || data === "H") {
      if (this.mode === "tree") {
        this.navigateUp();
      }
    } else if (matchesKey(data, "right") || data === "l" || data === "L") {
      if (this.mode === "tree") {
        this.navigateInto();
      }
    }

    // Adjust scroll to keep selection visible
    this.adjustLeftScroll();
  }

  private handleRightPaneInput(data: string) {
    const viewportHeight = this.contentHeight || 20;
    if (matchesKey(data, "up")) {
      this.rightScroll = Math.max(0, this.rightScroll - 1);
      this.tui.requestRender();
    } else if (matchesKey(data, "down")) {
      this.rightScroll = Math.min(this.previewContent.length - 1, this.rightScroll + 1);
      this.tui.requestRender();
    } else if (matchesKey(data, "pageUp")) {
      this.rightScroll = Math.max(0, this.rightScroll - viewportHeight);
      this.tui.requestRender();
    } else if (matchesKey(data, "pageDown")) {
      this.rightScroll = Math.min(Math.max(0, this.previewContent.length - viewportHeight), this.rightScroll + viewportHeight);
      this.tui.requestRender();
    }
  }

  private adjustLeftScroll() {
    const contentHeight = this.contentHeight || 20;
    if (this.selectedIndex < this.leftScroll) {
      this.leftScroll = this.selectedIndex;
    } else if (this.selectedIndex >= this.leftScroll + contentHeight) {
      this.leftScroll = this.selectedIndex - contentHeight + 1;
    }
    this.tui.requestRender();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onClose();
  }

  render(width: number): string[] {
    const dialogWidth = Math.max(40, width);
    const innerWidth = dialogWidth - 2;
    const leftWidth = Math.floor(innerWidth * 0.35);
    const rightWidth = innerWidth - leftWidth - 1; // -1 for divider
    const rows = process.stdout.rows ?? 30;
    const dialogHeight = Math.max(12, Math.min(rows - 2, Math.floor(rows * 0.94)));
    // total = top + path + separator + content + content-bottom + footer + bottom
    const contentHeight = Math.max(4, dialogHeight - 6);
    this.contentHeight = contentHeight;

    if (this.markdownPreview && this.markdownPreviewWidth !== rightWidth) {
      const file = this.files[this.selectedIndex];
      this.renderMarkdownPreview(rightWidth, file?.name ?? "markdown file");
    }

    const lines: string[] = [];
    const th = this.theme;

    // Top border
    lines.push(th.fg("borderMuted", `┌${"─".repeat(innerWidth)}┐`));

    // Mode + path header (tree mode shows current dir)
    const modeLabel = this.mode === "tree" ? "Tree" : "Git";
    const pathText = this.mode === "tree"
      ? ` ${modeLabel} · ${this.currentDir} `
      : ` ${modeLabel} · ${this.cwd} `;
    const headerText = truncateToWidth(pathText, innerWidth - 2);
    const header = th.fg("accent", th.bold(headerText));
    const headerPad = Math.max(0, innerWidth - visibleWidth(header));
    lines.push(`${th.fg("borderMuted", "│")}${header}${" ".repeat(headerPad)}${th.fg("borderMuted", "│")}`);

    // Separator
    const sepMid = this.focusedPane === "right" ? th.fg("accent", "┬") : th.fg("borderMuted", "┬");
    lines.push(th.fg("borderMuted", `├${"─".repeat(leftWidth)}`) + sepMid + th.fg("borderMuted", `${"─".repeat(rightWidth)}┤`));

    // Content rows
    for (let row = 0; row < contentHeight; row++) {
      const leftLine = this.renderLeftLine(row, leftWidth, contentHeight);
      const rightLine = this.renderRightLine(row, rightWidth, contentHeight);
      const paneDivider = this.focusedPane === "right" ? th.fg("accent", "│") : th.fg("borderMuted", "│");
      lines.push(`${th.fg("borderMuted", "│")}${leftLine}${paneDivider}${rightLine}${th.fg("borderMuted", "│")}`);
    }

    // Content bottom border
    const botMid = this.focusedPane === "right" ? th.fg("accent", "┴") : th.fg("borderMuted", "┴");
    lines.push(th.fg("borderMuted", `├${"─".repeat(leftWidth)}`) + botMid + th.fg("borderMuted", `${"─".repeat(rightWidth)}┤`));

    // Footer hints — only show keys that reliably work in the overlay context.
    // Tab and Backspace are handled above but may be intercepted by pi's TUI
    // framework before reaching the overlay, depending on keybindings config.
    let hints = this.mode === "tree"
      ? " ↑↓nav · Enter/l open dir · h/← go up · Tab (right) scrolls · t tree · g git · Esc close "
      : " ↑↓nav · Enter open · Tab (right) scrolls · t tree · g git · Esc close ";

    // Append scroll indicator when content overflows viewport
    const lineCount = this.previewContent.length;
    const contentOverflows = lineCount > contentHeight || this.rightScroll > 0;
    if (contentOverflows) {
      hints += " — Scroll ";
    }

    const footer = th.fg("dim", truncateToWidth(hints, innerWidth));
    const footerPad = Math.max(0, innerWidth - visibleWidth(footer));
    lines.push(`${th.fg("borderMuted", "│")}${footer}${" ".repeat(footerPad)}${th.fg("borderMuted", "│")}`);

    // Bottom border
    lines.push(th.fg("borderMuted", `└${"─".repeat(innerWidth)}┘`));

    return lines;
  }

  private renderLeftLine(row: number, width: number, contentHeight: number): string {
    if (this.files.length === 0) {
      const msg = this.mode === "git" && !this.isGitRepo
        ? "Not a git repository"
        : "Empty directory";
      if (row === Math.floor(contentHeight / 2)) {
        const text = this.theme.fg("dim", truncateToWidth(msg, width));
        return this.center(text, width);
      }
      return " ".repeat(width);
    }

    // Scroll is adjusted in adjustLeftScroll() called from input handling

    const fileIndex = this.leftScroll + row;
    const file = this.files[fileIndex];
    if (!file) return " ".repeat(width);

    const isSelected = fileIndex === this.selectedIndex;
    const isFocused = isSelected && this.focusedPane === "left";

    // Build prefix like micro editor: + for dirs (except ..), nothing for files
    let prefix = "";
    if (this.mode === "tree") {
      if (file.isDirectory && file.name !== "..") {
        prefix = "+ ";
      } else if (!file.isDirectory) {
        prefix = "  ";
      } else {
        prefix = "  "; // .. entry
      }
    } else if (this.mode === "git" && file.gitStatus) {
      prefix = this.gitStatusIcon(file.gitStatus);
    }

    let name = file.name;
    const maxNameWidth = width - visibleWidth(prefix) - 2;
    if (visibleWidth(name) > maxNameWidth) {
      name = truncateToWidth(name, maxNameWidth - 3) + "...";
    }

    // Style: directories in accent color, files in normal text
    let styledName: string;
    if (file.isDirectory && file.name !== "..") {
      styledName = this.theme.fg("accent", name);
    } else {
      styledName = name;
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

  private renderRightLine(row: number, width: number, contentHeight: number): string {
    const lineIndex = this.rightScroll + row;
    const line = this.previewContent[lineIndex];

    // Use strict undefined check so empty strings (valid blank lines) still render
    if (line === undefined) {
      return " ".repeat(width);
    }

    // truncateToWidth handles ANSI codes correctly — preserve colors from delta and markdown output
    let display = truncateToWidth(line, width);

    if (visibleWidth(display) < width) {
      display += " ".repeat(width - visibleWidth(display));
    }

    return display;
  }

  private gitStatusIcon(status: string): string {
    const code = status.trim();
    if (code.startsWith("M") || code.endsWith("M")) return "📝 ";
    if (code.startsWith("A") || code.endsWith("A")) return "✨ ";
    if (code.startsWith("D") || code.endsWith("D")) return "🗑️ ";
    if (code === "??") return "❓ ";
    return "📝 ";
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
