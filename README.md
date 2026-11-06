# Orchard Workspace

A GNOME Shell 51 extension for switching workspaces on one display at a time. Move the pointer to a display and switch workspaces; the other displays stay in place. You can also switch all displays together.

Orchard builds on [Active Monitor Workspaces](https://github.com/IndyDevGuy/active-monitor-workspaces). It lets you add workspaces to each display, gives fullscreen windows temporary workspaces, and works with GNOME's desktop gestures and overview.

## Project status

Only a basic version with basic testing has been completed. The extension is still at an early stage. It needs more testing on live desktops, across display setups, and alongside other extensions.

## AI disclosure and distribution

This extension was generated with the help of AI models. Because of its AI-generated nature, this project will not be distributed through the GNOME Extensions site (extensions.gnome.org). Follow the build and install instructions below to install it manually.

## Usage

The settings window has one switch, **Switch only the active display**:

- **On**: a workspace gesture switches workspaces on the display under the pointer. Other displays stay in place.
- **Off**: GNOME switches workspaces on all displays together.

With this switch on, each display starts with one workspace unless it already has windows on others. Orchard keeps those occupied workspaces too. Press **Ctrl+Super+N** to add a workspace to the display under the pointer and switch to it.

When a normal application window enters fullscreen, Orchard gives it a temporary workspace on its display. When it leaves fullscreen, Orchard returns it to its original workspace. If you open another fullscreen window from there, Orchard tracks where each window should return. If you move a window yourself, Orchard stops managing its return. If you put other windows in a temporary workspace, Orchard keeps that workspace.

Desktop and overview gestures follow each display's workspace order and stop at the first and last workspace. In the overview, you can also use the mouse wheel, Page Up/Down, thumbnail clicks, and window drops. Other displays keep their windows and thumbnail positions and sizes. The overview opens and closes with GNOME's normal animation.

Orchard adds no panel indicator, notifications, or on-screen display. **Ctrl+Super+Up/Down** switch workspaces on the selected display when the switch is on, or on all displays when it is off. You can change the shortcuts with GSettings.

| Default shortcut | Action | Where it works |
| --- | --- | --- |
| **Ctrl+Super+N** | Add a workspace on the display under the pointer and switch to it | Desktop and overview; active-display mode only |
| **Ctrl+Super+Up** | Previous workspace | Desktop |
| **Ctrl+Super+Down** | Next workspace | Desktop |

The pointer selects the active display. Fullscreen workspaces apply to normal application windows when **Switch only the active display** is on. Maximizing a window does not create a workspace.

## Requirements and limitations

- Requires GNOME Shell 51. Automated tests cover the code, but workspace management and overview changes still need testing on a live desktop.
- In GNOME **Settings → Multitasking**, choose **Workspaces on all displays**. Orchard leaves this setting and your choice of fixed or dynamic workspaces to you.
- GNOME still has one shared set of workspaces. Orchard gives each display its own list drawn from that set and adds workspaces when needed. In dynamic mode, Orchard keeps the workspaces it uses; GNOME manages the rest.
- Disabling Orchard leaves windows where they are. GNOME resumes its normal rules and may remove empty dynamic workspaces. Orchard saves its workspace lists only for the current session. When you enable it again, it rebuilds those lists from occupied workspaces; manually added empty workspaces do not persist.
- Orchard temporarily changes internal Shell methods and moves normal windows between workspaces to keep other displays in place. Extensions that change the same methods may conflict. Orchard skips workspace animations for fullscreen changes and its own shortcuts. Other ways of switching workspaces, apart from gestures, may still use GNOME's animations.
- If you use Kiwi, turn off **Move Window to New Workspace** (`org.gnome.shell.extensions.kiwi` → `move-window-to-new-workspace`). Kiwi can move a fullscreen window after Orchard has placed it, shift other workspaces, and break the window's return path. You can leave Kiwi's other features on. Orchard does not change Kiwi's settings.
- Disable other copies or variants of Active Monitor Workspaces before enabling Orchard.

## Build and install

You need GNOME Shell 51 and the `gnome-extensions` command. GNOME Shell loads the JavaScript directly, so there are no npm packages to install or JavaScript bundles to build. Only the tests need Node.js.

From the repository root:

```sh
mkdir -p dist
gnome-extensions pack --force --extra-source=LICENSE --extra-source=shell --out-dir=dist .
gnome-extensions install dist/orchard-workspace@cbuchler.github.io.shell-extension.zip
```

On Wayland, you may need to log out and back in before GNOME finds the extension. Then enable **Orchard Workspace** in the Extensions app and choose the switching mode in its settings.

You can also enable it and open its settings from the command line:

```sh
gnome-extensions enable orchard-workspace@cbuchler.github.io
gnome-extensions prefs orchard-workspace@cbuchler.github.io
```

To replace an existing installation, rebuild the ZIP and install it with `--force`:

```sh
gnome-extensions install --force dist/orchard-workspace@cbuchler.github.io.shell-extension.zip
```

Log out and back in on Wayland to load the updated Shell code. To disable Orchard:

```sh
gnome-extensions disable orchard-workspace@cbuchler.github.io
```

## Configuration

**Switch only the active display** is on by default. GSettings stores this choice and the shortcuts. For a standard installation in your home directory, point `gsettings` to the extension's schema directory:

```sh
orchard_schema_dir="$HOME/.local/share/gnome-shell/extensions/orchard-workspace@cbuchler.github.io/schemas"

# Inspect all settings.
gsettings --schemadir "$orchard_schema_dir" list-recursively org.gnome.shell.extensions.orchard-workspace

# Example: change the add-workspace shortcut to Ctrl+Super+M.
gsettings --schemadir "$orchard_schema_dir" set org.gnome.shell.extensions.orchard-workspace add-active-display-workspace "['<Control><Super>m']"

# Restore its default shortcut.
gsettings --schemadir "$orchard_schema_dir" reset org.gnome.shell.extensions.orchard-workspace add-active-display-workspace
```

The other keys are `active-monitor-only`, `switch-active-display-previous`, and `switch-active-display-next`. If you installed Orchard in another data directory, change `orchard_schema_dir` to match.

## Project structure

| Path | Purpose |
| --- | --- |
| `metadata.json` | Extension UUID, supported Shell version, and settings schema |
| `extension.js` | Activation, keybindings, signals, and cleanup |
| `prefs.js` | Preferences UI, running in a separate process |
| `schemas/` | Switching-mode and shortcut defaults |
| `shell/monitor.js` | Selects the display under the pointer and checks the switching mode |
| `shell/lifecycle.js` | Manages workspace lists, fullscreen return paths, and display connections |
| `shell/switcher.js` | Switches workspaces and moves windows to keep other displays in place |
| `shell/animation.js` | Handles desktop gestures |
| `shell/overview.js`, `shell/navigation.js` | Keeps each display's overview separate and handles navigation |
| `shell/projections.js`, `shell/thumbnails.js`, `shell/thumbnailGeometry.js` | Shows each display's workspaces and sizes and positions its thumbnails |
| `shell/methodOverrides.js` | Temporary Shell method overrides and restoration |
| `tests/` | Node.js tests with simulated GNOME actors and windows |
| `dist/` | Generated extension ZIPs; ignored by Git |

## Tests

Run commands from the repository root. These tests need only Node.js and use its built-in modules:

```sh
node tests/workspace-switching.cjs
node tests/method-overrides.cjs
node tests/overview-isolation.cjs
```

These tests also need GNOME Shell 51 source files. By default, they use `/usr/bin/gresource` to extract the files from `/usr/lib/gnome-shell/libshell-51.so`:

```sh
node tests/gesture-animation.cjs
node tests/overview-native-scroll.cjs
node tests/overview-navigation.cjs
```

To use files you have already extracted, set these variables to their paths:

| Variable | GNOME Shell source |
| --- | --- |
| `AMW_SHELL_ANIMATION_SOURCE` | `workspaceAnimation.js` |
| `ORCHARD_OVERVIEW_SOURCE` | `workspacesView.js` |
| `ORCHARD_WORKSPACE_SOURCE` | `workspace.js` |
| `ORCHARD_WM_SOURCE` | `windowManager.js` |
| `ORCHARD_THUMBNAIL_SOURCE` | `workspaceThumbnail.js` |
| `ORCHARD_SWIPE_SOURCE` | `swipeTracker.js` |

The lifecycle and thumbnail tests need you to set the source paths. If you have the library above, extract the files to a temporary directory and run:

```sh
orchard_test_sources=$(mktemp -d)
/usr/bin/gresource extract /usr/lib/gnome-shell/libshell-51.so /org/gnome/shell/ui/windowManager.js > "$orchard_test_sources/windowManager.js"
/usr/bin/gresource extract /usr/lib/gnome-shell/libshell-51.so /org/gnome/shell/ui/workspaceThumbnail.js > "$orchard_test_sources/workspaceThumbnail.js"
export ORCHARD_WM_SOURCE="$orchard_test_sources/windowManager.js"
export ORCHARD_THUMBNAIL_SOURCE="$orchard_test_sources/workspaceThumbnail.js"

node tests/lifecycle.cjs
node tests/overview-thumbnails.cjs
node tests/overview-dynamic-geometry.cjs
```

Extracting files from the Shell library requires `gresource` with ELF support. The examples use the system binary because other builds may lack it. On other systems, use the variables above to supply extracted GNOME 51 files. The tests share `tests/runtime-source.cjs` to load the extension code; it is not a test itself.

The tests use simulated actors and windows. They do not check the appearance or behavior of a live desktop.

The tests cover:

- Workspace creation on each display, fixed and dynamic workspaces, fullscreen return paths, manual window moves, display connection changes, and cleanup.
- Overview navigation across workspace boundaries, gesture cancellation, workspace changes, and view sizing.
- Thumbnail positions and sizes as GNOME adds or removes workspaces, including narrow layouts, clicks, window drops, and animation cleanup.
- Gesture targets and adding workspaces by dragging windows into the overview.

## Contributing, feature requests, and bugs

Use [GitHub Issues](https://github.com/cbuchler/orchard-workspace/issues) to report bugs, request features, or discuss a contribution. Search existing issues first. If one covers your topic, add your findings there.

- **Bugs:** Include steps to reproduce the problem, what you expected, and what happened. Add your GNOME Shell version, Linux distribution, session type (Wayland or X11), display setup, workspace settings, and relevant extensions. Include logs or screenshots when they help.
- **Feature requests:** Describe the problem you want to solve and how the proposed feature would help.
- **Contributions:** Open an issue to discuss the change before starting work. Keep pull requests focused, link the issue, and describe what changed and how you tested it. Run the relevant tests and note any live desktop checks or testing gaps. Update the documentation when behavior changes.

## Attribution

Orchard builds on [Active Monitor Workspaces](https://github.com/IndyDevGuy/active-monitor-workspaces), which includes work from [gnome-shell-extension-simulate-switching-workspaces-on-active-monitor](https://github.com/micheledaros/gnome-shell-extension-simulate-switching-workspaces-on-active-monitor). See [LICENSE](LICENSE) for the MIT license and original copyright notices.
