/*
 * Orchard Workspace
 *
 * Based on Active Monitor Workspaces by IndyDevGuy and
 * gnome-shell-extension-simulate-switching-workspaces-on-active-monitor.
 * Copyright (c) 2019 Xiaoguang Wang
 * Copyright (c) 2026 IndyDevGuy
 * Distributed under the MIT License; see LICENSE.
 */

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const PREVIOUS = 'switch-active-display-previous';
const NEXT = 'switch-active-display-next';

// Resolve the pointer at the moment of the gesture or shortcut. This doesn't
// require a motion listener or a background polling timer.
class MonitorResolver {
    resolve() {
        const [x, y] = global.get_pointer();
        const monitors = Main.layoutManager.monitors ?? [];
        let closest = 0;
        let closestDistance = Infinity;
        for (let i = 0; i < monitors.length; i++) {
            const m = monitors[i];
            if (x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height)
                return m.index ?? i;
            const nearestX = Math.max(m.x, Math.min(x, m.x + m.width));
            const nearestY = Math.max(m.y, Math.min(y, m.y + m.height));
            const distance = (x - nearestX) ** 2 + (y - nearestY) ** 2;
            if (distance < closestDistance) {
                closestDistance = distance;
                closest = m.index ?? i;
            }
        }
        return closest;
    }
}

class ConfigurationService {
    constructor(settings) {
        this.settings = settings;
        this.spanDisplays = false;
    }
    conditionallyEnableAutomaticSwitching() {
        this.spanDisplays = !Meta.prefs_get_workspaces_only_on_primary();
    }
    automaticSwitchingIsEnabled() {
        return this.spanDisplays && this.settings.get_boolean('active-monitor-only');
    }
}

/* The GNOME Shell gesture integration below is adapted from the source project. */
class MonitorWorkspaceAnimation {
    constructor(controller, configurationService, monitorResolver) {
        this._controller = controller;
        this._configuration = configurationService;
        this._resolver = monitorResolver;
        this._session = null;
        this._hooks = [];
    }

    enable() {
        const controller = this._controller;
        if (!controller || ['_prepareWorkspaceSwitch', '_finishWorkspaceSwitch', '_findMonitorGroup']
            .some(name => typeof controller[name] !== 'function'))
            throw new Error('Unsupported GNOME workspace animation controller');

        const animation = this;
        this._wrap('_prepareWorkspaceSwitch', original => function (...args) {
            const previous = this._switchData;
            const result = original.apply(this, args);
            // Explicit indices are the non-gesture animateSwitch path. Its
            // window snapshot timing is different, so leave it to Shell.
            if (!previous && !args[0] && this._switchData) {
                animation._configuration.conditionallyEnableAutomaticSwitching();
                if (animation._configuration.automaticSwitchingIsEnabled()) {
                    try {
                        animation._pinOtherMonitors(this._switchData);
                    } catch (error) {
                        // Preparation already acquired Shell's modal grab.
                        // Undo partial pins and let the native gesture finish.
                        animation._releaseSession();
                        logError(error, 'Orchard Workspace: animation hook unavailable');
                    }
                }
            }
            return result;
        });
        this._wrap('_findMonitorGroup', original => function (monitorIndex) {
            const session = animation._session;
            if (session?.switchData === this._switchData)
                monitorIndex = session.monitorIndex;
            return original.call(this, monitorIndex);
        });
        this._wrap('_finishWorkspaceSwitch', original => function (switchData) {
            if (animation._session?.switchData === switchData)
                animation._releaseSession();
            return original.call(this, switchData);
        });
    }

    _wrap(name, makeWrapper) {
        const controller = this._controller;
        const descriptor = Object.getOwnPropertyDescriptor(controller, name);
        const wrapper = makeWrapper(controller[name]);
        controller[name] = wrapper;
        this._hooks.push({ name, descriptor, wrapper });
    }

    _pinOtherMonitors(switchData) {
        const monitorIndex = this._resolver.resolve();
        if (!switchData.monitors.some(group => group.index === monitorIndex))
            return;
        // Check every private field before changing any actor.
        if (switchData.monitors.some(group => !group._container))
            return;

        const session = { switchData, monitorIndex, pins: [] };
        this._session = session;
        for (const group of switchData.monitors) {
            if (group.index === monitorIndex) continue;
            const container = group._container;
            const { x, y, translation_x: tx, translation_y: ty } = container;
            const pin = { group, container, tx, ty, destroyed: false,
                progressId: 0, destroyId: 0 };
            session.pins.push(pin);
            // Do not freeze `progress`: Shell needs it for interrupted swipes,
            // snap points and its primary-monitor completion transition. Only
            // cancel the visual displacement, synchronously before repaint.
            pin.progressId = group.connect('notify::progress', () => {
                container.translation_x = tx + x - container.x;
                container.translation_y = ty + y - container.y;
            });
            pin.destroyId = group.connect('destroy', () => { pin.destroyed = true; });
        }
    }

    get selectedMonitor() {
        return this._session?.monitorIndex ?? null;
    }

    _releaseSession() {
        const session = this._session;
        this._session = null;
        if (!session) return;
        for (const pin of session.pins) {
            if (pin.destroyed) continue;
            try {
                if (pin.progressId) pin.group.disconnect(pin.progressId);
                if (pin.destroyId) pin.group.disconnect(pin.destroyId);
                pin.container.translation_x = pin.tx;
                pin.container.translation_y = pin.ty;
            } catch (error) {
                logError(error, 'Orchard Workspace: releasing animation pin');
            }
        }
    }

    cancel() {
        const session = this._session;
        if (!session) return;
        if (this._controller._switchData === session.switchData) {
            // Stop completion callbacks before cancelling (disable/hotplug).
            for (const group of session.switchData.monitors)
                group.remove_all_transitions();
            this._controller._finishWorkspaceSwitch(session.switchData);
        } else {
            this._releaseSession();
        }
    }

    destroy() {
        this.cancel();
        for (const { name, descriptor, wrapper } of this._hooks.reverse()) {
            // Do not overwrite a hook installed subsequently by another
            // extension. Our captured wrapper becomes an inert pass-through.
            if (this._controller[name] !== wrapper) continue;
            if (descriptor)
                Object.defineProperty(this._controller, name, descriptor);
            else
                delete this._controller[name];
        }
        this._hooks = [];
        this._configuration = { conditionallyEnableAutomaticSwitching() {},
            automaticSwitchingIsEnabled: () => false };
    }
}


class WorkspaceSwitcher {
    constructor(configuration, resolver, animation) {
        this.configuration = configuration;
        this.resolver = resolver;
        this.animation = animation;
        this.syncActiveWorkspace();
    }

    syncActiveWorkspace() {
        const manager = global.workspace_manager;
        this.activeIndex = manager.get_active_workspace_index();
        this.activeWorkspace = manager.get_workspace_by_index(this.activeIndex);
    }

    movableWindows() {
        return global.get_window_actors()
            .map(actor => actor.get_meta_window())
            .filter(window => window && window.get_workspace() &&
                window.get_window_type() === Meta.WindowType.NORMAL &&
                !window.is_on_all_workspaces());
    }

    moveWindow(window, shift) {
        const count = global.workspace_manager.get_n_workspaces();
        const index = window.get_workspace().index();
        const target = ((index + shift) % count + count) % count;
        window.change_workspace_by_index(target, false);
    }

    onGlobalWorkspaceChanged() {
        const manager = global.workspace_manager;
        const index = manager.get_active_workspace_index();
        const workspace = manager.get_workspace_by_index(index);
        const previous = this.activeWorkspace;
        const previousIndex = previous?.index() ?? this.activeIndex;
        this.activeIndex = index;
        this.activeWorkspace = workspace;

        // GNOME can renumber the same workspace when it removes an empty one.
        if (previous === workspace || previousIndex < 0 ||
            !this.configuration.automaticSwitchingIsEnabled())
            return;

        const monitor = this.animation.selectedMonitor ?? this.resolver.resolve();
        const shift = index - previousIndex;
        for (const window of this.movableWindows()) {
            if (window.get_monitor() !== monitor)
                this.moveWindow(window, shift);
        }
    }

    switchWorkspace(direction) {
        this.configuration.conditionallyEnableAutomaticSwitching();
        if (!this.configuration.automaticSwitchingIsEnabled()) {
            const manager = global.workspace_manager;
            const workspace = manager.get_workspace_by_index(manager.get_active_workspace_index());
            const vertical = manager.layout_rows === -1;
            const motion = direction < 0
                ? (vertical ? Meta.MotionDirection.UP : Meta.MotionDirection.LEFT)
                : (vertical ? Meta.MotionDirection.DOWN : Meta.MotionDirection.RIGHT);
            const target = workspace.get_neighbor(motion);
            if (target && target !== workspace)
                target.activate(global.get_current_time());
            return;
        }

        const monitor = this.resolver.resolve();
        for (const window of this.movableWindows()) {
            if (window.get_monitor() === monitor)
                this.moveWindow(window, -direction);
        }
    }
}

export default class SwitchWorkspacesExtension extends Extension {
    enable() {
        const settings = this.getSettings();
        const configuration = new ConfigurationService(settings);
        const resolver = new MonitorResolver();
        configuration.conditionallyEnableAutomaticSwitching();
        const animation = new MonitorWorkspaceAnimation(
            Main.wm._workspaceAnimation, configuration, resolver);
        const switcher = new WorkspaceSwitcher(configuration, resolver, animation);
        this._state = {settings, configuration, animation, switcher, signals: [], bindings: []};

        try {
            animation.enable();
            for (const [name, direction] of [[PREVIOUS, -1], [NEXT, 1]]) {
                Main.wm.addKeybinding(name, settings, Meta.KeyBindingFlags.NONE,
                    Shell.ActionMode.NORMAL, () => switcher.switchWorkspace(direction));
                this._state.bindings.push(name);
            }
            const connect = (object, signal, callback) => {
                this._state.signals.push([object, object.connect(signal, callback)]);
            };
            connect(global.workspace_manager, 'active-workspace-changed', () => {
                configuration.conditionallyEnableAutomaticSwitching();
                switcher.onGlobalWorkspaceChanged();
            });
            connect(Main.layoutManager, 'monitors-changed', () => animation.cancel());
            connect(settings, 'changed::active-monitor-only', () => {
                animation.cancel();
                configuration.conditionallyEnableAutomaticSwitching();
                switcher.syncActiveWorkspace();
            });
        } catch (error) {
            this.disable();
            throw error;
        }
    }

    disable() {
        if (!this._state) return;
        const state = this._state;
        this._state = null;
        for (const [object, id] of state.signals)
            object.disconnect(id);
        for (const name of state.bindings)
            Main.wm.removeKeybinding(name);
        state.animation.destroy();
    }
}
