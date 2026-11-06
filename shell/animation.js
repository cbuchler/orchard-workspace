/*
 * Orchard Workspace
 *
 * Based on Active Monitor Workspaces by IndyDevGuy and
 * gnome-shell-extension-simulate-switching-workspaces-on-active-monitor.
 * Copyright (c) 2019 Xiaoguang Wang
 * Copyright (c) 2026 IndyDevGuy
 * Distributed under the MIT License; see LICENSE.
 */

// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.


import {MethodOverrides} from './methodOverrides.js';

/* The GNOME Shell gesture integration below is adapted from the source project. */
export class MonitorWorkspaceAnimation {
    constructor(controller, configurationService, monitorResolver, lifecycle = null) {
        this._controller = controller;
        this._configuration = configurationService;
        this._resolver = monitorResolver;
        this._lifecycle = lifecycle;
        this._session = null;
        this._overrides = new MethodOverrides();
    }

    enable() {
        const animation = this;
        this._wrap('_prepareWorkspaceSwitch', original => function (...args) {
            const previous = this._switchData;
            let nativeArgs = args;
            if (!args[0] && animation._lifecycle && animation._configuration.automaticSwitchingIsEnabled()) {
                const order = animation._lifecycle.orderForMonitor(animation._resolver.resolve());
                const workspaces = animation._lifecycle.workspaces();
                if (order?.workspaces.length)
                    nativeArgs = [order.workspaces.map(workspace => workspaces.indexOf(workspace))];
            }
            const result = original.apply(this, nativeArgs);
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
        this._overrides.add(this._controller, name, makeWrapper);
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
            const pin = { group, container, tx, ty,
                progressId: 0, destroyId: 0 };
            session.pins.push(pin);
            // Do not freeze `progress`: Shell needs it for interrupted swipes,
            // snap points and its primary-monitor completion transition. Only
            // cancel the visual displacement, synchronously before repaint.
            pin.progressId = group.connect('notify::progress', () => {
                container.translation_x = tx + x - container.x;
                container.translation_y = ty + y - container.y;
            });
            pin.destroyId = group.connect('destroy', () => {
                pin.group = null;
                pin.container = null;
            });
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
            if (!pin.group) continue;
            if (pin.progressId) pin.group.disconnect(pin.progressId);
            if (pin.destroyId) pin.group.disconnect(pin.destroyId);
            pin.container.translation_x = pin.tx;
            pin.container.translation_y = pin.ty;
            pin.group = null;
            pin.container = null;
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
        this._overrides.clear();
        this._controller = null;
        this._configuration = null;
        this._resolver = null;
        this._lifecycle = null;
    }
}
