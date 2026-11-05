# Orchard Workspace

A small GNOME Shell 51 extension for switching workspaces on the display under the pointer. It is extracted from [Active Monitor Workspaces](https://github.com/IndyDevGuy/active-monitor-workspaces), including the GNOME 51 gesture changes developed in this workspace.

The extension has one preference, **Switch only the active display**:

- **On**: a workspace gesture changes the display under the pointer while the other displays stay in place.
- **Off**: GNOME switches workspaces on all displays together.

It has no panel indicator, workspace preview, labels, notifications, or OSD. The default keyboard shortcuts are **Ctrl+Super+Up** and **Ctrl+Super+Down**. In active-display mode they rotate windows on the display under the pointer; in all-displays mode they switch GNOME's workspace. The shortcut bindings can be changed with GSettings.

## Requirements and limitations

- GNOME Shell 51. Other versions have not been tested with this extracted extension.
- In GNOME **Settings → Multitasking**, choose **Workspaces on all displays**. The extension does not change GNOME's workspace settings for you.
- Fixed and dynamic workspaces are supported experimentally. GNOME still has one underlying workspace list: gestures stop at its global boundaries, so this is not a set of completely independent dynamic workspace stacks.
- The extension temporarily wraps private GNOME Shell workspace-animation methods and moves normal windows between GNOME workspaces. Other extensions that modify the same animation or workspace behavior may conflict.
- The stationary animation applies to trackpad gestures. GNOME's non-gesture workspace animations are unchanged.
- Disable other copies or derivatives of Active Monitor Workspaces before enabling this extension, to avoid having multiple extensions manipulate the same workspaces and animation controller.

## Build and install

From this directory:

```sh
mkdir -p dist
gnome-extensions pack --force --extra-source=LICENSE --out-dir=dist .
gnome-extensions install dist/orchard-workspace@cbuchler.github.io.shell-extension.zip
```

GNOME may need a new login session to discover a manually installed extension on Wayland. Then enable **Orchard Workspace** in the Extensions app and open its settings to choose the switching mode.

## Tests

```sh
node tests/workspace-switching.cjs
node tests/gesture-animation.cjs
```

The gesture test extracts the animation controller from the installed GNOME 51 Shell library. To use an already extracted copy, set `AMW_SHELL_ANIMATION_SOURCE` to its path. The tests use simulated actors and windows; they are not a live desktop or visual test.

## Attribution

This extension derives from [Active Monitor Workspaces](https://github.com/IndyDevGuy/active-monitor-workspaces), which itself includes work from [gnome-shell-extension-simulate-switching-workspaces-on-active-monitor](https://github.com/micheledaros/gnome-shell-extension-simulate-switching-workspaces-on-active-monitor). The original copyright notices and MIT license are preserved in [LICENSE](LICENSE).
