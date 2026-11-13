# Orchard Workspace

A GNOME Shell 50/51 extension for switching workspaces on one display at a time. Move the pointer to a display and switch workspaces; the other displays stay in place. You can also switch all displays together.

Orchard builds on [Active Monitor Workspaces](https://github.com/IndyDevGuy/active-monitor-workspaces). It lets you add workspaces to each display, gives fullscreen windows temporary workspaces, and works with GNOME's desktop gestures and overview.

## Project status

Only a basic version with basic testing has been completed. The extension is still at an early stage. It needs more testing on live desktops, across display setups, and alongside other extensions.

See the [changelog](CHANGELOG.md) for changes in each release.

## AI disclosure and distribution

This extension was generated with the help of AI models. Because of its AI-generated nature, this project will not be distributed through the GNOME Extensions site (extensions.gnome.org). Follow the build and install instructions below to install it manually.

## Usage

The settings window has one switch, **Switch only the active display**:

- **On**: a workspace gesture switches workspaces on the display under the pointer. Other displays stay in place.
- **Off**: GNOME switches workspaces on all displays together.

With this switch on, each display starts with one workspace unless it already has windows on others. Orchard keeps those occupied workspaces too. Press **Ctrl+Super+N** to add a workspace to the display under the pointer and switch to it.

Press **Ctrl+Super+Delete** to remove that display's active empty desktop. Orchard selects the previous desktop, or the next one when removing the first. It keeps at least one desktop and refuses to remove occupied or fullscreen-owned desktops. The shortcut also works in the overview.

When a normal application window enters fullscreen, Orchard gives it a temporary workspace immediately after its originating logical desktop on that display. When it leaves fullscreen, Orchard returns it to its original workspace. If you open another fullscreen window from there, Orchard tracks where each window should return. If you move a window yourself, Orchard stops managing its return. If you put other windows in a temporary workspace, Orchard keeps that workspace.

Desktop and overview gestures follow each display's workspace order and stop at the first and last workspace. In the overview, you can also use the mouse wheel, Page Up/Down, thumbnail clicks, and window drops. Other displays keep their windows and thumbnail positions and sizes. The overview opens and closes with GNOME's normal animation.

Orchard adds no panel indicator, notifications, or on-screen display. **Ctrl+Super+Up/Down** switch workspaces on the selected display when the switch is on, or on all displays when it is off. You can change the shortcuts with GSettings.

| Default shortcut | Action | Where it works |
| --- | --- | --- |
| **Ctrl+Super+N** | Add a workspace on the display under the pointer and switch to it | Desktop and overview; active-display mode only |
| **Ctrl+Super+Up** | Previous workspace | Desktop |
| **Ctrl+Super+Down** | Next workspace | Desktop |

The pointer selects the active display. Fullscreen workspaces apply to normal application windows when **Switch only the active display** is on. Maximizing a window does not create a workspace.

GNOME's configured workspace shortcuts follow the same per-display desktop list. Previous/next stops at the first/last desktop without creating one. Numbered shortcuts select the corresponding desktop in that display's logical list (starting at 1); an unavailable number does nothing. The last-workspace shortcut selects the last logical desktop. In all-displays mode, GNOME's normal global numbering and navigation apply.

GNOME's move-to-workspace shortcuts use the focused window's display, even when the pointer is elsewhere. Directional, numbered and last-workspace moves follow that display's logical list. Boundary moves do nothing; adding a desktop remains an explicit action.

Activating an existing window through GNOME's window helper, app switcher or app launcher selects that window's display, even when the pointer is elsewhere. That display ownership lasts only for the activation call; subsequent gestures and shortcuts use the pointer again. A successful activation replaces an older in-progress switch, while a rejected activation leaves it running.

GNOME may focus a newer transient window instead of the requested app window. Orchard follows that effective target. Windows in its parent/transient family are revealed together, including relatives on another display; unrelated windows on that display retain their desktop. GNOME moves these related windows together, so a family spanning displays does not behave as independent windows.

## Requirements and limitations

- Supports exactly the current stable GNOME Shell major and its predecessor: currently 51.x and 50.x. Source checks cover 50.0, 50.6, 51.0 and 51.1; isolated real-window GNOME 50.1 checks pass on extracted official Shell/Mutter packages using host common libraries. This does not establish full GNOME 50 distribution or physical-desktop acceptance. See the [compatibility policy and exact evidence](docs/GNOME_COMPATIBILITY.md).
- In GNOME **Settings → Multitasking**, choose **Workspaces on all displays**. Orchard leaves this setting and your choice of fixed or dynamic workspaces to you.
- GNOME still has one shared set of workspaces. Orchard gives each display its own list drawn from that set and adds workspaces when needed. In dynamic mode, Orchard keeps the workspaces it uses; GNOME manages the rest.
- Disabling Orchard leaves windows where they are. GNOME resumes its normal rules and may remove empty dynamic workspaces. Orchard saves ordinary desktop identities, order and selection for recognized displays, including empty desktops. It rebuilds missing backing workspaces on re-enable or a new login; temporary fullscreen ownership is not saved.
- Orchard temporarily changes internal Shell methods and moves normal windows between workspaces to keep other displays in place. Extensions that change the same methods may conflict. Ordinary Orchard previous/next and add-and-select actions use the same desktop slide as native shortcuts. Fullscreen-owned desktop changes remain immediate to avoid layering a workspace slide over the app's fullscreen transition. Shell's animation settings still control the slide.
- Animated keyboard switches can be interrupted by another switch without resetting the slide. Orchard keeps the current position and velocity, then settles at the new destination. In active-display mode, the animation uses that display's logical desktop order, including sparse or rotated mappings into GNOME's workspace pool. All-displays mode uses the global pool. Longer desktop lists require more temporary window clones.
- In active-display mode, an animated keyboard switch keeps the other displays stationary. The selected display stays locked until that slide finishes, even if the pointer crosses to another display during rapid key presses.
- If you use Kiwi, turn off **Move Window to New Workspace** (`org.gnome.shell.extensions.kiwi` → `move-window-to-new-workspace`). Kiwi can move a fullscreen window after Orchard has placed it, shift other workspaces, and break the window's return path. You can leave Kiwi's other features on. Orchard does not change Kiwi's settings.
- Disable other copies or variants of Active Monitor Workspaces before enabling Orchard.

### Saved desktop layouts

During the same Shell session, Orchard reconnects surviving workspace objects to their saved desktop UUIDs, even if GNOME renumbers them. If GNOME prunes an empty workspace while Orchard is disabled, Orchard creates a replacement. A native workspace selection made while Orchard is disabled takes priority over the former saved selection; existing windows stay where GNOME placed them.

After logout/login, compositor objects and app-to-desktop associations are new. Orchard restores the selected desktop UUID on the current workspace, assigns the remaining occupied workspaces to saved desktop positions in GNOME's current order, then rebuilds empty desktops. Additional occupied workspaces are retained. This restores the desktop list without moving windows to guess their old associations. A saved empty desktop may receive newly launched or session-restored windows when their current placement takes priority.

Display matching uses connector names plus vendor, product and serial when Mutter provides them. If a connector changes, Orchard restores a hardware identity only when it identifies one saved and one connected display unambiguously. Identical or unknown displays use the exact connector arrangement; unmatched displays start from their current windows, and absent saved displays remain available for a later reconnect. No physical unplug/replug acceptance is implied by the model tests.

State is versioned in the internal `logical-layout` GSettings key. Missing, corrupt, unsupported-version or oversized state falls back to the current occupied layout. The saved format is bounded to 32 display identities and 64 ordinary desktops per display. To discard saved layouts, disable Orchard, reset this key with the schema directory shown below, then re-enable it. All-displays mode leaves the saved per-display layout untouched.

## Build and install

You need GNOME Shell 50 or 51 and the `gnome-extensions` command. GNOME Shell loads the JavaScript directly, so there are no npm packages to install or JavaScript bundles to build. Only the tests need Node.js.

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
| `shell/activation.js` | Carries destination-display ownership through Shell window and app activation calls |
| `shell/shortcuts.js` | Routes native workspace shortcuts through logical per-display desktop lists |
| `shell/lifecycle.js` | Manages workspace lists, fullscreen return paths, and display connections |
| `shell/persistence.js` | Saves versioned display/desktop UUIDs and reconciles current compositor objects without moving windows |
| `shell/switcher.js` | Switches workspaces and moves windows to keep other displays in place |
| `shell/animation.js` | Handles desktop gestures |
| `shell/keyboardAnimation.js` | Retargets interrupted keyboard animations and cleans up their actors |
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
node tests/persistence.cjs
```

For the same four-version source/model matrix used by CI, run `python3 scripts/gnome-source-matrix.py --report /tmp/orchard-gnome-sources.json`. It downloads immutable, hash-checked GNOME source fixtures and needs Python 3 and Node.js. The [compatibility policy](docs/GNOME_COMPATIBILITY.md) explains release monitoring and live validation.

Individual source-backed tests default to `/usr/bin/gresource` extraction from `/usr/lib/gnome-shell/libshell-51.so`:

```sh
node tests/gesture-animation.cjs
node tests/activation.cjs
node tests/native-shortcuts.cjs
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
| `ORCHARD_MAIN_SOURCE` | `main.js` (activation tests) |

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

Extracting files from the Shell library requires `gresource` with ELF support. The examples use the system binary because other builds may lack it. On other systems, use the variables above to supply matching extracted GNOME 50 or 51 files, or use the pinned matrix helper. The tests share `tests/runtime-source.cjs` to load the extension code; it is not a test itself.

The tests use simulated actors and windows. They do not check the appearance or behavior of a live desktop.

The tests cover:

- Workspace creation on each display, fixed and dynamic workspaces, fullscreen return paths, manual window moves, display connection changes, and cleanup.
- Saved desktop UUID order/selection, same-session index renumbering and empty-workspace pruning, fresh-session occupied/dialog-only reconciliation, absent and ambiguous displays, corrupt state, fullscreen exclusion and save-idle cleanup.
- Window-helper, app-switcher and launcher activation with the pointer on the other display; activation ownership, recursion prevention and cleanup after rejected or failed requests.
- Native shortcuts with callbacks bound before Orchard loads, sparse/rotated desktop orders, logical numbers and boundaries, window moves, mode fallback and signal cleanup.
- Overview navigation across workspace boundaries, gesture cancellation, workspace changes, and view sizing.
- Thumbnail positions and sizes as GNOME adds or removes workspaces, including narrow layouts, clicks, window drops, and animation cleanup.
- Gesture targets and adding workspaces by dragging windows into the overview.
- Keyboard switch interruption in Mutter's kill-then-switch order, repeated taps, direction reversals, position and velocity continuity, deferred cleanup, and cancellation on disable or display changes.
- Hidden windows staying hidden on inactive displays throughout repeated keyboard switches, stationary snapshots, and display selection staying fixed until the slide finishes.

## Isolated live validation

See the [recorded results and remaining acceptance](docs/LIVE_VALIDATION.md) for exact tested builds and environments.

The optional live harness runs a separate headless compositor with two virtual displays and real GTK windows. It uses a private D-Bus session and separate settings, runtime and extension directories. It does not install Orchard into the current desktop. Requirements are GNOME Shell with headless support, Python 3 with PyGObject/GTK 4, `dbus-run-session`, and `glib-compile-schemas`.

```sh
/usr/bin/python3 tests/live/run.py --case native-right --case orchard --require-major 51 --output /tmp/orchard-live-check
```

Use a fresh output directory for each run; prior evidence is never overwritten. Omit `--case` to run the shortcut matrix on both displays. Add `--extension-source /path/to/worktree` to test another checkout. `--shell` selects a compositor binary and `--require-major` rejects the wrong installed major. Supplying another version's JavaScript to the Node tests does not substitute for running that compositor.

The default uses a fixed workspace pool. Add `--workspace-mode dynamic` to exercise GNOME's dynamic pruning. These checks track workspace object identity separately from physical index renumbering. `--jobs 2` runs two independent private sessions concurrently; the default is sequential.

Fullscreen and interrupted-move checks are explicit selections:

```sh
/usr/bin/python3 tests/live/run.py --case fullscreen-first --case fullscreen-middle --case fullscreen-last --require-major 51 --output /tmp/orchard-fullscreen-check
/usr/bin/python3 tests/live/run.py --case interrupted-move --case interrupted-gesture-move --case overview-move --case animations-disabled-move --require-major 51 --output /tmp/orchard-moving-window-check
/usr/bin/python3 tests/live/run.py --case remove-first --case remove-middle --case remove-last --case remove-explicit --case remove-keyboard --case remove-occupied --case remove-final --case remove-fullscreen-origin --case remove-fullscreen-last-origin --require-major 51 --output /tmp/orchard-removal-check
/usr/bin/python3 -m unittest discover -s tests/live -p 'test_*.py'
```

Each case records candidate source hashes, fixture preconditions, window/workspace state, animation samples, screenshots and runtime logs. Setup failures fail the case. Runtime JavaScript errors fail the case; shutdown errors are recorded separately. Gesture cases drive the real gesture-settlement controller rather than injecting a hardware gesture. Frame captures permit visual inspection but do not establish physical-monitor behavior, actual touchpad input, display unplug/replug, or acceptance alongside the user's other extensions.

Persistence checks require a candidate with layout persistence:

```sh
/usr/bin/python3 tests/live/run.py --case persist-reenable --case persist-offmode --case persist-new-shell --case fullscreen-mode-roundtrip --require-major 51 --output /tmp/orchard-persistence-check
```

The persistence cases wait for automatic saving, then compare desktop UUID order and selection on both displays. Re-enable also checks that existing windows keep their workspace identities and visibility. The off-mode case enables Orchard in all-displays mode before returning to independent mode; the fullscreen case checks the return path across a mode round-trip. The new-Shell case terminates only its private compositor and fixture clients, starts another compositor with the same private settings, then creates new clients. It checks that empty desktops and selection survive a fresh Shell process; it does not simulate app session restoration or the user's logout/login. Add `--workspace-mode dynamic` to check restoration alongside native empty-workspace pruning.

## Contributing, feature requests, and bugs

Use [GitHub Issues](https://github.com/cbuchler/orchard-workspace/issues) to report bugs, request features, or discuss a contribution. Search existing issues first. If one covers your topic, add your findings there.

- **Bugs:** Include steps to reproduce the problem, what you expected, and what happened. Add your GNOME Shell version, Linux distribution, session type (Wayland or X11), display setup, workspace settings, and relevant extensions. Include logs or screenshots when they help.
- **Feature requests:** Describe the problem you want to solve and how the proposed feature would help.
- **Contributions:** Open an issue to discuss the change before starting work. Keep pull requests focused, link the issue, and describe what changed and how you tested it. Run the relevant tests and note any live desktop checks or testing gaps. Update the documentation when behavior changes.

## Attribution

Orchard builds on [Active Monitor Workspaces](https://github.com/IndyDevGuy/active-monitor-workspaces), which includes work from [gnome-shell-extension-simulate-switching-workspaces-on-active-monitor](https://github.com/micheledaros/gnome-shell-extension-simulate-switching-workspaces-on-active-monitor). See [LICENSE](LICENSE) for the MIT license and original copyright notices.
