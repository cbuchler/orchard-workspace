# GNOME compatibility and release evidence

Orchard targets exactly the current stable GNOME Shell major and its immediate
predecessor: **51.x and 50.x**. Alpha, beta and release-candidate tags do not
advance this window. When 52.0 becomes stable, the target becomes 52.x/51.x.
Eligibility under this policy does not establish runtime compatibility.

`metadata.json` currently declares **51 only**. GNOME 50 must remain undeclared
until the live acceptance gate below passes. Do not disable Shell's version
validation to install an unvalidated release.

## Automated evidence

`tests/fixtures/gnome-shell.json` locks the upstream repository, immutable commit,
source paths and SHA-256 hashes. It contains the major-release floors (50.0 and
51.0) and audited maintenance endpoints (50.6 and 51.1). The GitHub Actions matrix
runs all JavaScript source/model suites against each exact version, without
relying on a runner's installed Shell. Reports retain fixture provenance and
each test's output. CI also checks syntax, schemas and release-monitor behavior.

Run all locked versions locally:

```sh
python3 scripts/gnome-source-matrix.py --report /tmp/orchard-gnome-sources.json
python3 -m unittest discover -s tests -p 'test_*.py'
python3 scripts/check-gnome-releases.py
```

Use `--cache-dir PATH --offline` to rerun verified fixtures without network
access. Hash mismatches fail before tests run. These checks execute upstream
JavaScript in model harnesses; they do not launch a compositor, render windows,
exercise GObject/Clutter ownership, or prove live compatibility.

## Private API audit

The upstream references are the [50.0 source tree](https://github.com/GNOME/gnome-shell/tree/aecaec6ad79e5f77e19d590d746d0f4c06825420/js),
[50.6 source tree](https://github.com/GNOME/gnome-shell/tree/f56828ce31c9c68a808ee63692368d36802c95dc/js),
[51.0 source tree](https://github.com/GNOME/gnome-shell/tree/2177bdf9624b2d285de7c1d34274073d3769d6b8/js),
and [51.1 source tree](https://github.com/GNOME/gnome-shell/tree/33da06854e229c256afd5872fedd83c28cbfa176/js).

| Surface | Result and protection |
| --- | --- |
| Window/App activation (`Meta.Window`, `Meta.Workspace`, `Shell.App`, `Main.activateWindow`) | Same entry points on both lines. GI methods and display ordering/time helpers are checked before enable; activation suites exercise upstream `Main.activateWindow`. |
| Window manager workspace actions and native shortcuts (`windowManager.js`) | Action signatures remain usable. GNOME 50's native move path directly blocks/unblocks its tracker; 51 uses WindowManager methods with nested accounting. Run each version's real action bodies, preserving native ownership. |
| Workspace tracker (`main.js`) | `_checkWorkspaces` / `_queueCheckWorkspaces` remain usable. Checked before enable; lifecycle tests execute the version's tracker. |
| Workspace animation (`workspaceAnimation.js`) | Preparation, group lookup, finish, switch and cancellation methods remain available. Checked before enable. Monitor group `_container`, switch data, progress and actor ownership remain private session data; existing guards and cancellation cleanup apply. GNOME 51 also changes minimized-window clone bookkeeping. Live visual tests remain required. |
| Overview navigation (`workspacesView.js`) | GNOME 51 uses `_moveToWorkspace` and binding-pool callbacks. GNOME 50 uses a prebound, display-owned stage `_onKeyPressEvent`. The focused adapter rebinds that audited callback and maps Page/Home/End to logical order only when native navigation is enabled; unrelated keys propagate without cancelling gestures. It retains display ownership so native `vfunc_hide` disconnects the callback, restores the native callback on disable, and avoids restoring it after native Overview teardown. |
| Overview views, thumbnails, DND and projections (`workspacesView.js`, `workspaceThumbnail.js`, `workspace.js`) | View/thumbnail hooks, adjustment fields, drag callbacks and membership updates are compatible in the four locked versions. Source/model tests cover each version. Instances created later are guarded when hooks are installed; failed session setup tears the session down. |
| Swipe input (`swipeTracker.js`) | Constructor, signal and actor-connection shapes are compatible in locked sources. Owned tracker connections/actions are captured and released, leaving native and third-party owners intact. |
| Animation timing (`environment.js`, `animationUtils.js`) | Both lines retain animation enable/slowdown handling. Motion settings require live acceptance alongside keyboard and gesture switching. |

`assertShellCompatibility()` runs before settings or lifecycle initialization and
checks the version, declared support and required startup methods. Missing
methods fail with an actionable name. `MethodOverrides.add()` rejects a missing
callable before writing the property. Existing enable/session error paths remove
hooks and resources after later failures. This detects known incompatible shapes;
it cannot prove that a future private method retains its meaning.

## Live release gate

For **each major**, record exact Shell/Mutter versions, distro build, revision,
display layout, motion settings, steps, expected/observed results, logs and
screenshots/video where needed. Use real windows on at least two virtual or
physical monitors. Cover independent switching and untouched-monitor pixels,
app/transient activation, logical shortcut ordering and window moves, Overview
keyboard/scroll/swipes/thumbnails/DND, fullscreen enter/leave/close, motion
settings, cancellation, monitor changes and repeated enable/disable cleanup.

Track this evidence in [live acceptance issue #3](https://github.com/cbuchler/orchard-workspace/issues/3).
An isolated session counts only for its actual matching compositor/runtime;
GNOME 50 source fixtures on a GNOME 51 host do not count as live GNOME 50.
No GNOME 50 live acceptance artifact was available when this infrastructure was
added. Metadata remains 51 pending that gate. Passing source/model CI, extension
ACTIVE state, and error-free startup each establish a narrower fact than the
full acceptance matrix.

## Maintenance process

1. The weekly scheduled CI and pull requests query official upstream tags.
   `check-gnome-releases.py` fails for a newer stable maintenance release on
   either target line, a newer stable major, or incomplete release discovery.
   Prereleases are ignored. A failed monitor requests review; it never changes
   metadata automatically.
2. For a maintenance update, pin its immutable upstream commit and hashes in the
   fixture lock, replace the old maintenance endpoint in CI (retain each major's
   floor), audit private API diffs, run the full source matrix and collect live
   acceptance evidence on the new builds. Report regressions and publish the
   focused compatibility fix before claiming the new build verified.
3. At a stable major release, advance `SUPPORTED_MAJORS`, the lock's
   `currentMajor`/`previousMajor`, CI versions and documentation together. Add
   the new major's floor/current endpoint. Remove the retired line's fixtures,
   adapters, support claims and metadata entry. Do not carry three majors.
4. Add the new major to metadata only after source and live checks pass. A
   validation gap must remain visible in release notes and the acceptance issue;
   never widen metadata just to match the target policy. Publish exact verified
   patch builds and links to CI and live artifacts in release evidence.

“Always works” is a maintenance target. Neither this policy nor a passing check
guarantees an untested future GNOME maintenance build.
