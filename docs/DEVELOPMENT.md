# Development and testing

[Back to the README](../README.md) · [User guide](USAGE.md)

Run commands from the repository root. Use Node.js 24 or later for lint and
JavaScript tests. Use Python 3 for the source matrix and release checks.

## Run the checks

1. Install the development dependencies:

   ```sh
   npm ci --ignore-scripts
   ```

2. Check the shipped JavaScript:

   ```sh
   npm run lint
   ```

3. Run the source/model tests:

   ```sh
   python3 scripts/gnome-source-matrix.py --report /tmp/orchard-gnome-sources.json
   ```

4. Run the Python tests:

   ```sh
   python3 -m unittest discover -s tests -p 'test_*.py'
   /usr/bin/python3 -m unittest discover -s tests/live -p 'test_*.py'
   ```

5. Check the settings schema:

   ```sh
   glib-compile-schemas --strict --dry-run schemas
   ```

6. Check whitespace:

   ```sh
   git diff --check
   ```

The source matrix downloads immutable GNOME files and checks their SHA-256
hashes. It runs all JavaScript suites against each locked version. Use
`--cache-dir PATH --offline` to use an existing verified cache.

ESLint checks correctness, unused variables and the 200-character line limit.
The npm dependencies are development tools. The extension package does not need
them at runtime.

CI runs lint, the source matrix, syntax checks and schema checks. It also runs
the release monitor. See [GNOME compatibility](GNOME_COMPATIBILITY.md) for the
support window, source pins and release procedure.

## What the tests establish

Source/model tests use simulated windows and actors. They check the extension
against selected GNOME code. They do not run a compositor or prove desktop
behavior.

| Area | Coverage |
| --- | --- |
| Workspace lists | Creation, removal safeguards, fixed/dynamic modes and display changes. |
| Saved layouts | UUID order, selection, empty entries, occupied workspaces, display matching and invalid data. |
| Fullscreen | Temporary workspaces, return paths, manual moves and focused dialogs. |
| Activation and shortcuts | Window/app activation, logical numbering, boundaries, window moves and display selection. |
| Overview | Keyboard/scroll navigation, thumbnails, geometry, window drops and gesture targets. |
| Animation | Interruptions, reversals, position/velocity continuity and unchanged inactive displays. |
| Cleanup | Partial startup failure, nested activation, rejected requests, save failure, signals and idle sources. |

For recorded results, use these documents:

- [Code-practices validation, 2026-11-15](CODE_PRACTICES.md#validation).
- [Fullscreen focus regression and repair](FULLSCREEN_FOCUS.md).
- [Earlier integrated validation and remaining acceptance](LIVE_VALIDATION.md).

## Run individual model tests

These examples need Node.js and its built-in modules:

```sh
node tests/workspace-switching.cjs
node tests/method-overrides.cjs
node tests/overview-isolation.cjs
node tests/persistence.cjs
node tests/startup-cleanup.cjs
```

Other suites need GNOME source files. The pinned source matrix is the simplest
way to supply them.

### Use local Shell sources

Some suites extract files from `/usr/lib/gnome-shell/libshell-51.so` by default:

```sh
node tests/gesture-animation.cjs
node tests/activation.cjs
node tests/native-shortcuts.cjs
node tests/overview-native-scroll.cjs
node tests/overview-navigation.cjs
```

To supply extracted source files, set these environment variables:

| Variable | GNOME Shell file |
| --- | --- |
| `AMW_SHELL_ANIMATION_SOURCE` | `workspaceAnimation.js` |
| `ORCHARD_OVERVIEW_SOURCE` | `workspacesView.js` |
| `ORCHARD_WORKSPACE_SOURCE` | `workspace.js` |
| `ORCHARD_WM_SOURCE` | `windowManager.js` |
| `ORCHARD_THUMBNAIL_SOURCE` | `workspaceThumbnail.js` |
| `ORCHARD_SWIPE_SOURCE` | `swipeTracker.js` |
| `ORCHARD_MAIN_SOURCE` | `main.js` |

The lifecycle and thumbnail suites require explicit source paths. On a system
with the Shell 51 library, run:

```sh
orchard_test_sources=$(mktemp -d)
/usr/bin/gresource extract /usr/lib/gnome-shell/libshell-51.so \
  /org/gnome/shell/ui/windowManager.js > "$orchard_test_sources/windowManager.js"
/usr/bin/gresource extract /usr/lib/gnome-shell/libshell-51.so \
  /org/gnome/shell/ui/workspaceThumbnail.js > "$orchard_test_sources/workspaceThumbnail.js"
export ORCHARD_WM_SOURCE="$orchard_test_sources/windowManager.js"
export ORCHARD_THUMBNAIL_SOURCE="$orchard_test_sources/workspaceThumbnail.js"

node tests/lifecycle.cjs
node tests/overview-thumbnails.cjs
node tests/overview-dynamic-geometry.cjs
```

The `gresource` binary must support ELF files. Some non-system builds do not.
For another installation, supply matching extracted GNOME 50 or 51 files.
`tests/runtime-source.cjs` loads extension code for other suites; it is not a test.

## Isolated live validation

The live harness starts a separate headless compositor with two virtual
displays and real GTK windows. It uses a private D-Bus session, settings and
extension copies. It does not install Orchard into your desktop session.

Requirements:

- GNOME Shell with headless support.
- Python 3 with PyGObject and GTK 4.
- `dbus-run-session` and `glib-compile-schemas`.

Run a small profile first:

```sh
/usr/bin/python3 tests/live/run.py \
  --case native-right --case orchard --require-major 51 \
  --output /tmp/orchard-live-check
```

Use a new output directory for each run. Keep the path short: Wayland socket
paths have a length limit. The harness refuses to overwrite existing evidence.

| Option | Purpose |
| --- | --- |
| `--case NAME` | Select a scenario. Repeat the option to select more scenarios. |
| No `--case` | Run the shortcut matrix on both displays. |
| `--extension-source PATH` | Test another checkout or worktree. |
| `--shell PATH` | Select the compositor executable. |
| `--require-major 50` or `51` | Reject the wrong runtime major. |
| `--workspace-mode dynamic` | Test dynamic workspace removal. The default is fixed. |
| `--jobs 2` | Run two private sessions in parallel. The default is one. |

### Select a focused profile

Fullscreen focus and return paths:

```sh
/usr/bin/python3 tests/live/run.py \
  --case fullscreen-first --case fullscreen-middle --case fullscreen-last \
  --case fullscreen-keyboard --case fullscreen-dialog-other \
  --require-major 51 --output /tmp/orchard-fullscreen-check
```

Interrupted window moves:

```sh
/usr/bin/python3 tests/live/run.py \
  --case interrupted-move --case interrupted-gesture-move \
  --case overview-move --case animations-disabled-move \
  --require-major 51 --output /tmp/orchard-moving-window-check
```

Workspace removal:

```sh
/usr/bin/python3 tests/live/run.py \
  --case remove-first --case remove-middle --case remove-last \
  --case remove-explicit --case remove-keyboard \
  --case remove-occupied --case remove-final \
  --case remove-fullscreen-origin --case remove-fullscreen-last-origin \
  --require-major 51 --output /tmp/orchard-removal-check
```

Saved layouts and fullscreen mode changes:

```sh
/usr/bin/python3 tests/live/run.py \
  --case persist-reenable --case persist-offmode --case persist-new-shell \
  --case fullscreen-mode-roundtrip \
  --require-major 51 --output /tmp/orchard-persistence-check
```

### Read the results

Each case records source hashes, fixture preconditions, window/workspace state,
animation samples, screenshots and logs. Setup failures and runtime JavaScript
errors fail the case. Shutdown errors have a separate count.

Persistence cases wait for automatic saving. They compare list UUIDs and
selection on both displays. Re-enable also checks window placement and visibility.
The off-mode case starts Orchard in all-displays mode before it enables
independent switching. The fullscreen mode case checks its return path.

The new-Shell case stops its private compositor and clients. It starts another
compositor with the saved settings, then launches new clients. This checks list
restoration across processes. It does not simulate application session restoration
or your logout/login.

Gesture cases drive the real gesture-settlement controller. They do not inject
physical touchpad input. Screenshots permit visual inspection; they do not prove
physical hotplug behavior or compatibility with other extensions.

Run each supported compositor to establish runtime evidence. Another version's
JavaScript in a model test does not replace that runtime check.

## Project structure

| Path | Purpose |
| --- | --- |
| `metadata.json`, `schemas/` | Supported versions, extension identity and settings. |
| `extension.js` | Startup, keybindings, signals and cleanup. |
| `prefs.js` | Preferences in a separate process. |
| `shell/monitor.js` | Display selection and mode checks. |
| `shell/activation.js` | Destination-display selection during window/app activation. |
| `shell/shortcuts.js` | Native shortcuts in logical workspace order. |
| `shell/lifecycle.js` | Workspace lists, fullscreen return paths and display changes. |
| `shell/persistence.js` | Saved UUIDs and reconciliation with current workspaces. |
| `shell/switcher.js` | Workspace switches and window moves that preserve other displays. |
| `shell/animation.js`, `shell/keyboardAnimation.js` | Gestures, keyboard slides, interruptions and actor cleanup. |
| `shell/overview.js`, `shell/navigation.js` | Display isolation and overview navigation. |
| `shell/projections.js`, `shell/thumbnails.js`, `shell/thumbnailGeometry.js` | Per-display views and thumbnail geometry. |
| `shell/compatibility.js`, `shell/methodOverrides.js` | Version checks, scoped adapters and method restoration. |
| `tests/`, `tests/live/` | Model/source suites and the isolated compositor harness. |
| `dist/` | Generated extension packages. Git ignores this directory. |

Keyboard animations keep their current position and velocity when interrupted.
They follow each display's logical order, including sparse or rotated native
workspace mappings. Longer lists need more temporary window clones.

See [code practices](CODE_PRACTICES.md) for lifecycle rules and cleanup evidence.

## Report a problem

Search [GitHub Issues](https://github.com/cbuchler/orchard-workspace/issues) before
you open a report. If an issue covers the problem, add your findings there.

Include:

- Steps to reproduce the problem.
- Expected and actual results.
- GNOME Shell version, distribution and session type (Wayland or X11).
- Display setup, workspace settings and relevant extensions.
- Relevant logs or screenshots.

For a feature request, describe the problem and the proposed benefit.

## Contribute

Open an issue to discuss the change before you start. Keep pull requests focused.
Link the issue. Describe the final behavior and the checks you ran. State any
remaining testing gaps. Update the documentation when behavior changes.

Keep the README focused on setup and everyday use. Put optional detail in linked
guides. For prose, follow [Orwell's writing rules](https://www.orwellfoundation.com/the-orwell-foundation/orwell/essays-and-other-works/politics-and-the-english-language/).
For technical instructions, use [ASD-STE100 style](https://www.asd-ste100.org/STE_faq.html):
use consistent terms, short active sentences and one instruction per sentence.
Keep command names, setting keys and API identifiers exact.
