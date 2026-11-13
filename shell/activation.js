// SPDX-License-Identifier: MIT
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import {MethodOverrides} from './methodOverrides.js';

// Mutter emits active-workspace-changed before focusing the requested window.
// Carry the destination display through the synchronous activation call, rather
// than using the pointer (or an interrupted animation) to compensate windows.
export class WindowActivation {
    constructor(configuration, resolver) {
        this._configuration = configuration;
        this._resolver = resolver;
        this._overrides = new MethodOverrides();
        this._enabled = false;
    }

    enable() {
        const activation = this;
        for (const name of ['activate', 'activate_with_workspace']) {
            this._overrides.add(Meta.Window.prototype, name, original => function (...args) {
                return activation._run(this, () => original.apply(this, args));
            });
        }
        this._overrides.add(Meta.Workspace.prototype, 'activate_with_focus', original => function (window, ...args) {
            return activation._run(window, () => original.call(this, window, ...args));
        });
        // Shell.App's C implementation calls Mutter directly, so intercepting
        // only Meta.Window or Main.activateWindow would miss app-switcher and
        // launcher activation. Preserve Shell's get_windows() ordering.
        for (const name of ['activate', 'activate_full', 'activate_window']) {
            this._overrides.add(Shell.App.prototype, name, original => function (...args) {
                const windows = this.get_windows();
                const window = name === 'activate_window' && args[0] != null
                    ? args[0] : windows[0];
                const target = windows.includes(window) ? activation._appTarget(window) : null;
                return activation._run(target, () => original.apply(this, args));
            });
        }
        this._enabled = true;
    }

    _appTarget(window) {
        // Match Shell 51's effective target without changing its arguments:
        // the topmost NORMAL/DIALOG transient on the same workspace wins only
        // when its user time is newer than the requested window's.
        const transients = [];
        window.foreach_transient(transient => {
            if (transient.get_workspace() === window.get_workspace())
                transients.push(transient);
            return true;
        });
        const top = global.display.sort_windows_by_stacking(transients).reverse().find(transient =>
            [Meta.WindowType.NORMAL, Meta.WindowType.DIALOG].includes(transient.get_window_type()));
        return top && global.display.xserver_time_is_before(window.get_user_time(), top.get_user_time())
            ? top : window;
    }

    _run(window, callback) {
        this._configuration.conditionallyEnableAutomaticSwitching();
        if (!this._enabled || !this._configuration.automaticSwitchingIsEnabled() ||
            !window?.get_workspace())
            return callback();

        const monitor = window.get_monitor();
        if (!this._resolver.hasMonitor(monitor))
            return callback();

        // Mutter moves ancestors and descendants together. Compensating any
        // cross-display relative could therefore move the activation target
        // away again. Reveal this family together; unrelated windows retain
        // their display's selected desktop through normal compensation.
        let root = window;
        while (root.get_transient_for())
            root = root.get_transient_for();
        const family = new Set([root]);
        root.foreach_transient(transient => { family.add(transient); return true; });
        const resolver = this._resolver;
        const previous = resolver.activation;
        resolver.activation = {monitor, family};
        try {
            return callback();
        } finally {
            // No token survives a rejected/stale activation or an exception.
            resolver.activation = this._enabled ? previous : null;
        }
    }

    destroy() {
        this._enabled = false;
        this._overrides.clear();
        this._resolver.activation = null;
    }
}
