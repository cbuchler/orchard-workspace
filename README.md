# Orchard Workspace

A GNOME Shell 51 extension that gives each display its own logical workspace order. Switch workspaces on the display under the pointer while keeping other displays in place, or switch all displays together using GNOME's normal behavior.

Orchard is derived from [Active Monitor Workspaces](https://github.com/IndyDevGuy/active-monitor-workspaces). It adds per-display workspace creation, temporary fullscreen workspaces, and integration with GNOME's desktop gestures and overview.

## Usage

The extension has one preference, **Switch only the active display**:

- **On**: a workspace gesture changes the display under the pointer while the other displays stay in place.
- **Off**: GNOME switches workspaces on all displays together.

In active-display mode, each clean display starts with one logical workspace.
**Ctrl+Super+N** adds a workspace to the display under the pointer and switches
to it. Existing workspaces containing windows on that display are imported so
that enabling Orchard never merges or hides existing windows.

Fullscreening a normal application window creates a separate temporary workspace
on its display. Leaving fullscreen returns that window to its original logical
workspace. Nested fullscreen windows retain their own return destinations. If
you move the window yourself, Orchard relinquishes its automatic return; if you
put other windows in its temporary workspace, that workspace is retained.

Desktop and overview gestures follow each display's logical order and stop at
its first and last slots. The overview also supports mouse-wheel navigation,
Page Up/Down, thumbnail clicks and window drops. Inactive displays retain their
workspace contents and thumbnail geometry while another display changes.
Opening and closing the overview still uses GNOME's normal transition.

There is no panel indicator, notification or OSD. **Ctrl+Super+Up/Down** navigate
the selected display's logical workspaces in active-display mode and GNOME's
workspaces in all-displays mode. Shortcut bindings can be changed with GSettings.

| Default shortcut | Action | Where it works |
| --- | --- | --- |
| **Ctrl+Super+N** | Add and activate a workspace on the display under the pointer | Desktop and overview; active-display mode only |
| **Ctrl+Super+Up** | Previous workspace | Desktop |
| **Ctrl+Super+Down** | Next workspace | Desktop |

The active display is selected by pointer position, rather than the focused window. Fullscreen workspace handling applies to normal application windows in active-display mode; ordinary maximization does not trigger it.

## Requirements and limitations

- GNOME Shell 51. This candidate has source-based automated coverage; its new logical lifecycle and projection still require live desktop validation.
- In GNOME **Settings → Multitasking**, choose **Workspaces on all displays**. Orchard does not change the global fixed/dynamic mode or primary-display setting.
- Fixed and dynamic workspaces use GNOME's shared physical workspace pool. Orchard exposes independent logical subsets and expands that pool when necessary. In dynamic mode it retains claimed logical slots while GNOME manages unused backing workspaces normally.
- Disabling Orchard leaves windows and physical workspaces where they currently are. GNOME then resumes its normal workspace policy, including removal of empty dynamic workspaces. Logical slot identities and manually added empty slots are session state and are rebuilt when Orchard is enabled again; occupied workspaces are imported.
- The extension temporarily wraps private Shell workspace, animation and overview methods and moves normal windows between physical workspaces to preserve inactive displays. Other extensions modifying those methods may conflict. Fullscreen transitions and Orchard shortcuts suppress workspace animations; native external non-gesture activations can still use GNOME's animations.
- In Kiwi, turn off **Move Window to New Workspace** (`org.gnome.shell.extensions.kiwi` → `move-window-to-new-workspace`) when using Orchard's fullscreen workspaces. Kiwi has its own delayed fullscreen workspace manager: it can move the window again, shift other workspaces and invalidate Orchard's return destination. Kiwi's other features can stay enabled. Orchard does not change Kiwi settings automatically.
- Disable other copies or derivatives of Active Monitor Workspaces before enabling Orchard.

## Build and install

You need GNOME Shell 51 and the `gnome-extensions` command. The runtime is JavaScript loaded by GNOME Shell; there is no npm dependency installation or bundling step. Node.js is only needed for the tests.

From the repository root:

```sh
mkdir -p dist
gnome-extensions pack --force --extra-source=LICENSE --extra-source=shell --out-dir=dist .
gnome-extensions install dist/orchard-workspace@cbuchler.github.io.shell-extension.zip
```

GNOME may need a new login session to discover a manually installed extension on Wayland. Then enable **Orchard Workspace** in the Extensions app and open its settings to choose the switching mode.

Alternatively, after GNOME discovers the extension:

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

The preferences window exposes **Switch only the active display**, enabled by default. Shortcut bindings are stored in the extension's GSettings schema. For a standard per-user installation, use its local schema directory when running `gsettings`:

```sh
orchard_schema_dir="$HOME/.local/share/gnome-shell/extensions/orchard-workspace@cbuchler.github.io/schemas"

# Inspect all settings.
gsettings --schemadir "$orchard_schema_dir" list-recursively org.gnome.shell.extensions.orchard-workspace

# Example: change the add-workspace shortcut to Ctrl+Super+M.
gsettings --schemadir "$orchard_schema_dir" set org.gnome.shell.extensions.orchard-workspace add-active-display-workspace "['<Control><Super>m']"

# Restore its default shortcut.
gsettings --schemadir "$orchard_schema_dir" reset org.gnome.shell.extensions.orchard-workspace add-active-display-workspace
```

The remaining keys are `active-monitor-only`, `switch-active-display-previous`, and `switch-active-display-next`. If your installation uses a custom data directory, adjust `orchard_schema_dir` accordingly.

## Project structure

| Path | Responsibility |
| --- | --- |
| `metadata.json` | Extension UUID, supported Shell version, and settings schema |
| `extension.js` | Activation, keybindings, signals, and cleanup |
| `prefs.js` | Preferences UI, running in a separate process |
| `schemas/` | Switching-mode and shortcut defaults |
| `shell/monitor.js` | Pointer-based display selection and mode checks |
| `shell/lifecycle.js` | Logical workspaces, fullscreen return destinations, and monitor lifecycle |
| `shell/switcher.js` | Workspace switching and window movement to preserve inactive displays |
| `shell/animation.js` | Desktop gesture integration |
| `shell/overview.js`, `shell/navigation.js` | Overview isolation and navigation |
| `shell/projections.js`, `shell/thumbnails.js`, `shell/thumbnailGeometry.js` | Logical workspace views, thumbnails, and geometry |
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

The following also need GNOME Shell 51 JavaScript sources. By default, they extract those sources using `/usr/bin/gresource` from `/usr/lib/gnome-shell/libshell-51.so`:

```sh
node tests/gesture-animation.cjs
node tests/overview-native-scroll.cjs
node tests/overview-navigation.cjs
```

The gesture and native overview tests extract code from the installed GNOME 51 Shell library. To use already extracted copies, set these variables to their source file paths:

| Variable | GNOME Shell source |
| --- | --- |
| `AMW_SHELL_ANIMATION_SOURCE` | `workspaceAnimation.js` |
| `ORCHARD_OVERVIEW_SOURCE` | `workspacesView.js` |
| `ORCHARD_WORKSPACE_SOURCE` | `workspace.js` |
| `ORCHARD_WM_SOURCE` | `windowManager.js` |
| `ORCHARD_THUMBNAIL_SOURCE` | `workspaceThumbnail.js` |
| `ORCHARD_SWIPE_SOURCE` | `swipeTracker.js` |

The lifecycle and thumbnail suites require explicit source paths. On a system with the library above, extract the files to a temporary directory and run:

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

Use a `gresource` build with ELF support to extract from the Shell library; the examples explicitly use the system binary because other installations can lack that support. On other systems, supply extracted GNOME 51 files through the variables above instead. `tests/runtime-source.cjs` is a shared loader, not a standalone test.

The tests use simulated actors and windows; they are not a live desktop or visual test.

The thumbnail test uses extracted GNOME 51 `workspaceThumbnail.js` and
`windowManager.js` sources supplied through the two environment variables above.
The navigation test also uses installed GNOME `workspacesView.js`, `windowManager.js`,
`workspaceThumbnail.js`, and `swipeTracker.js` methods to exercise logical seam
progression, allocation, cancellation, dynamic membership, and teardown.
The dynamic geometry test runs native workspace creation/pruning and thumbnail
allocation/lifecycle code for the primary-last-slot and secondary-first-swipe
cases, including constrained widths, clicks, drops, and animation cleanup.
The lifecycle test covers clean one-slot initialization, independent expansion,
fixed/dynamic retention, nested fullscreen return, user moves, connector hotplug,
unmanaged windows and cleanup. Native projection tests cover one-slot sizing,
logical gesture targets, physical pool changes and DND insertion.
Runtime Shell modules live in `shell/`; `extension.js` owns extension activation
and cleanup, and `prefs.js` runs separately in the preferences process.

## Attribution

This extension derives from [Active Monitor Workspaces](https://github.com/IndyDevGuy/active-monitor-workspaces), which itself includes work from [gnome-shell-extension-simulate-switching-workspaces-on-active-monitor](https://github.com/micheledaros/gnome-shell-extension-simulate-switching-workspaces-on-active-monitor). The original copyright notices and MIT license are preserved in [LICENSE](LICENSE).
