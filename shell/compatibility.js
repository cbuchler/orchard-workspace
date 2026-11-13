// SPDX-License-Identifier: MIT
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as OverviewControls from 'resource:///org/gnome/shell/ui/overviewControls.js';
import * as WorkspaceAnimation from 'resource:///org/gnome/shell/ui/workspaceAnimation.js';
import {MethodOverrides} from './methodOverrides.js';

// Advance this pair with the fixture lock and CI matrix at each stable release.
export const SUPPORTED_MAJORS = ['50', '51'];

function requiresWorkspaceStackingFix(version) {
    const [major, minor] = version.split('.').map(Number);
    return major === 50 && minor < 4;
}

export class WorkspaceStackingCompatibility {
    constructor() {
        this.overrides = new MethodOverrides();
    }

    enable() {
        if (!requiresWorkspaceStackingFix(Config.PACKAGE_VERSION)) return;
        // Upstream 50.4 includes fe0dadb2288a1b5fbf418c08de83ba57861a4885.
        // Earlier 50.x re-filters live actors, then dereferences a nonexistent
        // clone record when a window arrives during a retained snapshot.
        this.overrides.add(WorkspaceAnimation.WorkspaceGroup.prototype, '_syncStacking', () => function () {
            const stackIndeces = new Map(global.get_window_actors().map((actor, i) => [actor, i]));
            this._windowRecords.sort((a, b) => stackIndeces.get(a.windowActor) - stackIndeces.get(b.windowActor));
            let lastRecord;
            const bottomActor = this._background ?? null;
            for (const record of this._windowRecords) {
                this.set_child_above_sibling(record.clone, lastRecord ? lastRecord.clone : bottomActor);
                lastRecord = record;
            }
        });
    }

    destroy() {
        this.overrides.clear();
    }
}

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
    if (requiresWorkspaceStackingFix(Config.PACKAGE_VERSION))
        requireMethods(WorkspaceAnimation.WorkspaceGroup?.prototype, ['_syncStacking'], 'GNOME 50 WorkspaceGroup');
    requireMethods(Meta.Window?.prototype, ['activate', 'activate_with_workspace', 'get_transient_for', 'foreach_transient'], 'Meta.Window');
    requireMethods(Meta.Workspace?.prototype, ['activate_with_focus'], 'Meta.Workspace');
    requireMethods(Shell.App?.prototype, ['activate', 'activate_full', 'activate_window', 'get_windows'], 'Shell.App');
    requireMethods(global.display, ['sort_windows_by_stacking', 'xserver_time_is_before'], 'Meta.Display');
    requireMethods(Main.wm, ['_shouldAnimate', 'actionMoveWindow', 'actionMoveWorkspace', 'insertWorkspace', 'handleWorkspaceScroll'], 'WindowManager');
    requireMethods(Main.wm?._workspaceTracker, ['_checkWorkspaces', '_queueCheckWorkspaces'], 'WorkspaceTracker');
    requireMethods(Main.wm?._workspaceAnimation, ['_prepareWorkspaceSwitch', '_findMonitorGroup', '_finishWorkspaceSwitch', 'animateSwitch', 'cancelSwitchAnimation'], 'WorkspaceAnimationController');
    const display = Main.overview?._overview?.controls?._workspacesDisplay;
    requireMethods(display, ['_updateWorkspacesViews', '_endTouchGesture'], 'WorkspacesDisplay');
    if (typeof display._moveToWorkspace !== 'function') {
        requireMethods(display, ['_onKeyPressEvent'], 'GNOME 50 overview keyboard');
        requireMethods(global.stage, ['connectObject', 'disconnectObject'], 'GNOME 50 stage ownership');
    }
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
    const token = {withNeighbors};
    const handler = (actor, event) => {
        const invoke = () => original.call(display, actor, event);
        if (!token.withNeighbors) return invoke();
        const key = event.get_key_symbol();
        const picker = display._overviewAdjustment.value === OverviewControls.ControlsState.WINDOW_PICKER && display.reactive;
        if (!picker || ![Clutter.KEY_Page_Up, Clutter.KEY_Page_Down, Clutter.KEY_Home, Clutter.KEY_End].includes(key))
            return invoke();
        const boundary = key === Clutter.KEY_Home ? 'first'
            : key === Clutter.KEY_End ? 'last' : null;
        return token.withNeighbors(invoke, boundary);
    };
    stage.disconnectObject(display);
    // Native vfunc_hide disconnects this owner before destroying its views.
    // Observe that existing cleanup boundary without overriding a GObject vfunc.
    try {
        overrides.add(stage, 'disconnectObject', native => function (...owners) {
            if (owners.includes(display)) restore = false;
            return native.apply(this, owners);
        });
        stage.connectObject('key-press-event', handler, display);
    }
    catch (error) {
        stage.disconnectObject(display);
        stage.connectObject('key-press-event', original.bind(display), display);
        throw error;
    }
    return () => {
        token.withNeighbors = null;
        const restoreNative = restore && display.mapped;
        stage.disconnectObject(display);
        if (restoreNative)
            stage.connectObject('key-press-event', original.bind(display), display);
    };
}
