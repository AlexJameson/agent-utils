import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { FileViewOverlay } from "./overlay.js";
import type { FileViewMode } from "./types.js";

const COMMAND_TREE = "file-view:tree";
const COMMAND_GIT = "file-view:git";
const SHORTCUT = "ctrl+shift+f";

export default function (pi: ExtensionAPI) {
  let activeOverlay: { close: () => void } | null = null;

  function dismissOverlay() {
    if (activeOverlay) {
      activeOverlay.close();
      activeOverlay = null;
    }
  }

  async function openOverlay(ctx: ExtensionCommandContext | ExtensionContext, mode: FileViewMode) {
    if (!ctx.hasUI) {
      return;
    }

    dismissOverlay();

    const result = await ctx.ui.custom<void>(
      async (tui, theme, keybindings, done) => {
        const overlay = new FileViewOverlay({
          tui,
          theme,
          keybindings,
          cwd: ctx.cwd,
          initialMode: mode,
          onClose: () => {
            activeOverlay = null;
            done();
          },
          onModeChange: (newMode) => {
            // Mode changed internally, no external action needed
          },
        });

        activeOverlay = {
          close: () => {
            overlay.close();
            done();
          },
        };

        return overlay;
      },
      {
        overlay: true,
        overlayOptions: {
          width: "98%",
          margin: 1,
        },
      },
    );

    activeOverlay = null;
  }

  pi.registerCommand(COMMAND_TREE, {
    description: "Open file tree overlay",
    handler: async (_args, ctx) => {
      await openOverlay(ctx, "tree");
    },
  });

  pi.registerCommand(COMMAND_GIT, {
    description: "Open git changes overlay",
    handler: async (_args, ctx) => {
      await openOverlay(ctx, "git");
    },
  });

  pi.registerShortcut(SHORTCUT, {
    description: "Toggle file view overlay",
    handler: async (ctx) => {
      if (activeOverlay) {
        dismissOverlay();
        return;
      }
      await openOverlay(ctx, "tree");
    },
  });
}
