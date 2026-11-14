# Fullscreen keyboard focus regression — 2026-11-14

The physical test of `f49af58` exposed a focus regression: entering fullscreen
left the application visible, but keyboard focus moved to a window on the other
display. Pressing F11 again did not reach the fullscreen application until the
user clicked it.

## Cause and repair

Orchard moved the focused window onto its temporary backing workspace, then
activated that workspace without naming a focus target. Mutter could select an
unrelated window when the owner left the active workspace.

The repair captures the focused owner or its focused transient before moving
the window and uses `activate_with_focus()` for the desktop change. A request
on an already-active workspace focuses without leaving a pending desktop
navigation token. Background fullscreen changes do not explicitly take focus.

A focused transient can be on the other monitor. The activation wrapper now
keeps the fullscreen owner's navigation monitor only when both the exact focus
target and expected workspace match the explicit navigation request. Other
activation targets and stale workspace requests keep their normal monitor
selection. This preserves the temporary slot and its return chain.

The runtime repair is `aa66846`, including the original focus change in
`3dd4fb6`. Astra medium review identified the cross-monitor transient interaction
in the first patch; the revised patch was independently reproduced and cleared
with no remaining must-fix finding.

## Evidence

The earlier live fullscreen checks asserted placement, visibility and return
order, but did not assert focus. Their snapshots already recorded the lost
focus. A passing placement result must not be treated as keyboard acceptance.

New checks cover:

- Actual F11 input delivered to a GTK client, including the second F11 to exit.
- Entry and exit focus compared with the focus before the transition.
- Pointer on the other display, background fullscreen without explicit focus
  stealing, and a real focused transient on the other display.
- Fullscreen return through an independent/all-displays mode round-trip.
- Combined lifecycle, switcher and activation-wrapper model coverage for
  cross-display dialogs, unrelated nested targets, stale workspace intent and
  navigation-context cleanup.

All 17 JavaScript suites pass on the four pinned source versions, for **68
source/model passes**. All **15 Python harness validation tests** pass.

The immutable `aa66846` candidate and its harness pass these final real-window
profiles, with ten cases per profile (five scenarios on both displays):

| Compositor | Workspace mode | Passing cases | Operation-time JS errors |
| --- | --- | ---: | ---: |
| GNOME Shell 50.1 | Fixed | 10/10 | 0 |
| GNOME Shell 50.1 | Dynamic | 10/10 | 0 |
| GNOME Shell 51.0 | Fixed | 10/10 | 0 |
| GNOME Shell 51.0 | Dynamic | 10/10 | 0 |

The GNOME 50 runtime uses extracted official Shell/Mutter packages with matching
schemas and host common libraries. It does not establish full-distribution
acceptance. Shutdown `dateMenu._sync` diagnostics remain recorded separately;
each final profile has 14 such diagnostics after shutdown, not during the test
operations. Candidate and harness hashes match all 40 recorded manifests.

With the corrected F11 fixture, the unchanged `f49af58` build fails the input
round trip: entry changes focus and the second F11 does not exit the owner.
The repaired build additionally passes F11 on both displays with Maximize
Window Into New Workspace enabled after its startup delay. This confirms the
focus defect does not require that extension, while preserving the distinction
from the earlier unexplained ordinary-desktop growth on the physical desktop.

Local records are under:

```text
~/.local/state/orchard-workspace/fullscreen-focus-20261114/
```

The physical user's F11 test remains to be repeated after loading the repaired
build in a fresh Wayland Shell session. Multi-monitor keyboard switching and
touchpad gestures were visually confirmed and matched recorded logical
desktop changes in the preceding physical checks. That does not substitute
for the remaining acceptance matrix in issue #3.
