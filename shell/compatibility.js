// SPDX-License-Identifier: MIT
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as OverviewControls from 'resource:///org/gnome/shell/ui/overviewControls.js';

// Advance this pair with the fixture lock and CI matrix at each stable release.
export const SUPPORTED_MAJORS = ['50', '51'];

export function assertSupportedVersion(version, metadata) {
    const match = /^(\d+)\.\d+(?:\.\d+)?$/.exec(version);
    if (!match || !SUPPORTED_MAJORS.includes(match[1]) ||
        !metadata['shell-version']?.includes(match[1]))
        throw new Error(`Orchard Workspace is not validated for GNOME Shell ${version}`);
}

export function requireMethods(object, names, label) {
    const missing = names.filter(name => typeof object?.[name] !== 'function');
    if (missing.length)
        throw new Error(`Orchard Workspace: incompatible ${label}: ${missing.join(', ')}`);
}

export function assertShellCompatibility(metadata) {
    assertSupportedVersion(Config.PACKAGE_VERSION, metadata);
    requireMethods(Meta.Window?.prototype, ['activate', 'activate_with_workspace', 'get_transient_for', 'foreach_transient'], 'Meta.Window');
    requireMethods(Meta.Workspace?.prototype, ['activate_with_focus'], 'Meta.Workspace');
    requireMethods(Shell.App?.prototype, ['activate', 'activate_full', 'activate_window', 'get_windows'], 'Shell.App');
    requireMethods(global.display, ['sort_windows_by_stacking', 'xserver_time_is_before'], 'Meta.Display');
    requireMethods(Main.wm, ['_shouldAnimate', 'actionMoveWindow', 'actionMoveWorkspace', 'insertWorkspace', 'handleWorkspaceScroll'], 'WindowManager');
    requireMethods(Main.wm?._workspaceTracker, ['_checkWorkspaces', '_queueCheckWorkspaces'], 'WorkspaceTracker');
    requireMethods(Main.wm?._workspaceAnimation, ['_prepareWorkspaceSwitch', '_findMonitorGroup', '_finishWorkspaceSwitch', 'animateSwitch', 'cancelSwitchAnimation'], 'WorkspaceAnimationController');
    const display = Main.overview?._overview?.controls?._workspacesDisplay;
    requireMethods(display, ['_updateWorkspacesViews', '_endTouchGesture'], 'WorkspacesDisplay');
    if (typeof display._moveToWorkspace !== 'function')
        requireMethods(display, ['_onKeyPressEvent', 'prepareToLeaveOverview'], 'GNOME 50 overview keyboard');
}

export function installOverviewKeyboard(overrides, display, withNeighbors) {
    if (typeof display._moveToWorkspace === 'function') {
        overrides.add(display, '_moveToWorkspace', original => function (...args) {
            return withNeighbors(() => original.apply(this, args));
        });
        return () => {};
    }

    // GNOME 50 binds its only display-owned stage connection before Orchard
    // starts. Rebind that audited key-press callback, leaving other owners alone.
    const stage = global.stage;
    const original = display._onKeyPressEvent;
    let restore = true;
    overrides.add(display, 'prepareToLeaveOverview', native => function (...args) {
        restore = false;
        return native.apply(this, args);
    });
    const token = {withNeighbors};
    const handler = (actor, event) => {
        const invoke = () => original.call(display, actor, event);
        if (!token.withNeighbors) return invoke();
        const key = event.get_key_symbol();
        const picker = display._overviewAdjustment.value === OverviewControls.ControlsState.WINDOW_PICKER && display.reactive;
        const boundary = picker && key === Clutter.KEY_Home ? 'first'
            : picker && key === Clutter.KEY_End ? 'last' : null;
        return token.withNeighbors(invoke, boundary);
    };
    stage.disconnectObject(display);
    let id;
    try { id = stage.connect('key-press-event', handler); }
    catch (error) {
        stage.connectObject('key-press-event', original.bind(display), display);
        throw error;
    }
    return () => {
        token.withNeighbors = null;
        stage.disconnect(id);
        if (restore && display.mapped)
            stage.connectObject('key-press-event', original.bind(display), display);
    };
}
