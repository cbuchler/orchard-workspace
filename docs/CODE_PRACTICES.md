# GNOME extension code practices

This focused review follows GNOME's [extension review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)
and [best practices](https://gjs.guide/extensions/review-guidelines/best-practices.html).
It addresses four identified gaps; it does not claim an EGO review or complete
physical-desktop acceptance.

| Gap | Change | Regression evidence |
| --- | --- | --- |
| Mutable module cache retained across disable | Workspace bindings belong to the persistence instance and are released with its parsed state and restored-stack set. Saved window sequence numbers reconnect occupied desktops within the same Shell epoch. | Persistence suite checks cleanup, occupied UUID associations through native renumbering, replacement empty backings, old v1 records and bounded window lists. |
| Activation `_enabled` lifecycle guard | Wrappers detach on destruction; configuration/resolver/override references are released. The synchronous call restores its previous context only if it still owns the resolver's current context. | Activation suite covers normal/nested ownership, exceptions, disable inside either nested call and retained wrapper pass-through. |
| Startup rollback started after restoration and construction | The entrypoint records owned helpers as it builds them, inside one rollback boundary. Failed enable tears down without saving a partial layout. A failed normal save still releases the remaining services. | Entrypoint fault injection covers settings, initialization, restoration, helper construction, partial hooks, keybindings and signals. Persistence suite checks cleanup after a settings write failure. |
| No linter in CI | Pinned ESLint and recommended correctness rules cover `extension.js`, `prefs.js` and every Shell module, including unused variables and the 200-character line limit. CI installs the lockfile without dependency scripts. | `npm ci --ignore-scripts` and `npm run lint`. |

No Shell objects, signals, callbacks or growing maps remain in module-level
persistence storage. The immutable epoch string scopes the saved numeric window
identifiers to one loaded Shell module; new Shells do not reuse those associations.
Mutter documents [window sequence numbers](https://mutter.gnome.org/meta/method.Window.get_stable_sequence.html)
as unique integers assigned at window creation. Old saved layouts without window
identifiers remain readable through passive reconciliation.

GNOME has no public stable workspace identifier. Consequently, releasing native
workspace bindings on disable means an empty logical desktop can receive a new
native backing on re-enable. Its UUID, logical order and count remain saved.
Restoration does not move windows or activate a workspace. Window groups changed
while disabled and new Shell sessions use the existing passive reconciliation.

## Validation

Validation completed on 2026-11-15:

- ESLint passes after a clean lockfile installation. An intentional undefined
  variable/unused variable input fails, confirming the gate detects both errors.
- All 18 source/model suites pass on each pinned Shell version: 50.0, 50.6,
  51.0 and 51.1 (72 passes). The 19 Python tests, syntax/schema checks and
  stable-release freshness check pass.
- All 48 isolated real-window scenarios pass: GNOME Shell/Mutter 50.1 and
  51.0, fixed/dynamic workspaces, both virtual displays, and six scenarios per
  profile. These cover re-enable, all-displays startup, a fresh Shell process,
  actual F11 entry/exit, focused cross-display dialogs and fullscreen mode cycles.
- Every accepted case matches the frozen runtime and harness hashes. All report
  zero operation-time JavaScript or capture errors. The extracted GNOME 50
  packages use host common libraries; this is not a full GNOME 50 distribution.
- The packaged extension matches all 20 runtime/metadata/license/schema files,
  excludes npm development files and compiles its extracted schema successfully.

Evidence is retained locally under
`~/.local/state/orchard-workspace/practices-20261115/`, including
`verification.json`, exact source hashes, logs, snapshots and captures.
Initial overly long socket paths failed before extension loading. One GNOME 51
fixture lost its prepared focus before input; a separate valid retry passed.
The first GNOME 51 fixed runner exited with status 143 after eight aggregated
results; the remaining cases completed in a separate batch. Those attempts are
retained rather than counted as passes. Shutdown-only native `dateMenu._sync`
diagnostics are retained separately (87 across the accepted scenarios).

These checks do not establish physical hotplug behavior or all third-party
extension combinations. The installed desktop extension is updated separately
from committing or pushing repository changes.
