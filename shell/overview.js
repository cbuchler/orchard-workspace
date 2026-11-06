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

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {MonitorWorkspaceOrder, OverviewThumbnails} from './thumbnails.js';
import {MethodOverrides} from './methodOverrides.js';
import {OverviewNavigation} from './navigation.js';
import {OverviewWorkspaceProjections} from './projections.js';

// GNOME drives all overview monitor views with one scroll adjustment. Keep a
// private adjustment for each inactive display until the overview closes.
export class OverviewWorkspaceIsolation {
    constructor(configuration, resolver, lifecycle = null) {
        this._configuration = configuration;
        this._resolver = resolver;
        this._lifecycle = lifecycle;
        this._session = null;
        this._signals = [];
        this._orders = new Map();
        this.syncLogicalOrders();
    }

    _workspaces() {
        const manager = global.workspace_manager;
        return Array.from({length: manager.get_n_workspaces()}, (_, i) => manager.get_workspace_by_index(i));
    }

    enable() {
        this._signals.push([Main.overview, Main.overview.connect('showing', () => this.refresh())]);
        this._signals.push([Main.overview, Main.overview.connect('hiding', () => this.stop())]);
        this.refresh();
    }

    refresh() {
        this._configuration.conditionallyEnableAutomaticSwitching();
        if (!this._configuration.automaticSwitchingIsEnabled() ||
            !Main.overview.visible || Main.overview.closing) {
            this.stop();
            return;
        }
        if (!this._session) this._start();
    }

    _wrap(session, object, name, wrapperFactory) {
        session.overrides.add(object, name, wrapperFactory);
    }

    _start() {
        this.syncLogicalOrders();
        const controls = Main.overview._overview.controls;
        const display = controls._workspacesDisplay;
        const hosts = display._workspacesViews;
        const shared = display._scrollAdjustment;
        if (hosts.length < (this._lifecycle ? 1 : 2)) return;

        const records = hosts.map((host, index) => ({
            host, index, view: host._workspacesView ?? host,
            local: null, pinned: false,
            viewDestroyId: 0, hostDestroyId: 0,
        }));
        if (records.some(({view}) => view._scrollAdjustment !== shared)) return;

        const session = {display, shared, records, overrides: new MethodOverrides(), selected: null,
            gesture: false, motionId: 0, managerSignals: [], inserting: false, insertion: null};
        this._session = session;
        try {
            for (const record of records) {
                record.viewDestroyId = record.view.connect('destroy', () => {
                    session.overrides.forgetObject(record.view);
                    session.navigation?.overrides.forgetObject(record.view);
                    session.projections?.forgetView(record.view);
                    if (record.host === record.view) record.host = null;
                    record.view = null;
                    this.stop();
                });
                if (record.host !== record.view) {
                    record.hostDestroyId = record.host.connect('destroy', () => {
                        session.overrides.forgetObject(record.host);
                        record.host = null;
                        this.stop();
                    });
                }
                this._wrap(session, record.view, '_scrollToActive', original => function (...args) {
                    if (!record.pinned) return original.apply(this, args);
                });
                this._wrap(session, record.host, 'startTouchGesture', original => (...args) => {
                    if (!session.gesture) {
                        this._updateSelection();
                        session.gesture = true;
                    }
                    return original.apply(record.host, args);
                });
            }
            const isolation = this;
            for (const record of records) {
                const box = record.host._thumbnails ??
                    (record.host === record.view ? controls._thumbnailsBox : null);
                if (!box) continue;
                if (box._scrollAdjustment !== shared)
                    throw new Error('Overview thumbnail adjustment was changed by another extension');
                let order = this._orders.get(record.index);
                if (!order) {
                    order = new MonitorWorkspaceOrder(this._workspaces());
                    this._orders.set(record.index, order);
                }
                record.order = order;
                record.thumbnails = new OverviewThumbnails(this, session, record, box, order);
            }
            if (records.some(record => record.thumbnails)) {
                for (const signal of ['notify::n-workspaces', 'workspaces-reordered']) {
                    session.managerSignals.push(global.workspace_manager.connect(signal, () => {
                        for (const record of records) record.thumbnails?.refresh();
                    }));
                }
                this._wrap(session, Main.wm, 'insertWorkspace', original => function (position) {
                    const before = isolation._workspaces();
                    const snapshots = records.map(record => record.thumbnails?.order.workspaces.map(ws => before.indexOf(ws)));
                    for (const record of records) record.thumbnails?.geometry.freeze();
                    session.inserting = true;
                    try { return original.call(this, position); }
                    finally {
                        session.inserting = false;
                        const after = isolation._workspaces();
                        if (after.length === before.length + 1) {
                            const mapping = new Map(before.map((workspace, index) => [workspace, after[index >= position ? index + 1 : index]]));
                            for (const record of records) record.thumbnails?.geometry.remap(mapping);
                            records.forEach((record, i) => {
                                if (!record.thumbnails) return;
                                const order = record.thumbnails.order;
                                order.workspaces = snapshots[i].map(index => after[index >= position ? index + 1 : index]);
                                const insertAt = session.insertion?.adapter === record.thumbnails
                                    ? session.insertion.position : order.workspaces.length;
                                if (order.insert) {
                                    if (session.insertion?.adapter === record.thumbnails)
                                        order.insert(insertAt, after[position]);
                                } else {
                                    order.workspaces.splice(insertAt, 0, after[position]);
                                }
                            });
                        }
                        for (const record of records) record.thumbnails?.refresh();
                        isolation.syncActiveWorkspace();
                    }
                });
            }
            if (display._swipeTracker) {
                for (const record of records) {
                    if (!record.order) {
                        record.order = this._orders.get(record.index) ?? new MonitorWorkspaceOrder(this._workspaces());
                        this._orders.set(record.index, record.order);
                    }
                }
                session.navigation = new OverviewNavigation(this, session);
                session.navigation.start();
                if (this._lifecycle) {
                    session.projections = new OverviewWorkspaceProjections();
                    for (const record of records) {
                        session.projections.addView(record);
                        if (record.thumbnails) session.projections.addThumbnails(record.thumbnails);
                    }
                    session.navigation.refresh();
                }
            }
            this._wrap(session, display, '_updateWorkspacesViews', original => function (...args) {
                isolation.stop();
                const result = original.apply(this, args);
                isolation.refresh();
                return result;
            });
            this._wrap(session, display, '_endTouchGesture', original => function (...args) {
                try { return original.apply(this, args); }
                finally {
                    session.gesture = false;
                    if (isolation._session === session) {
                        try { isolation._updateSelection(); }
                        catch (error) { isolation.stop(); logError(error, 'Orchard Workspace: overview selection'); }
                    }
                }
            });
            session.motionId = global.stage.connect('motion-event', () => {
                if (!session.gesture) {
                    try { this._updateSelection(); }
                    catch (error) { this.stop(); logError(error, 'Orchard Workspace: overview selection'); }
                }
                return Clutter.EVENT_PROPAGATE;
            });
            this._updateSelection();
        } catch (error) {
            this.stop();
            logError(error, 'Orchard Workspace: overview isolation unavailable');
        }
    }

    _pin(record, session) {
        if (record.pinned) return;
        const {view} = record;
        const shared = session.shared;
        if (view._scrollAdjustment !== shared)
            throw new Error('Overview workspace adjustment was changed by another extension');
        const local = new St.Adjustment({actor: view, value: shared.value,
            lower: shared.lower, upper: shared.upper, page_size: shared.page_size,
            step_increment: shared.step_increment, page_increment: shared.page_increment});
        shared.disconnectObject(view);
        record.local = local;
        record.pinned = true;
        view._scrollAdjustment = local;
    }

    _unpin(record, session) {
        if (!record.pinned) return;
        record.pinned = false;
        const {view, local} = record;
        if (view._scrollAdjustment === local) {
            view._scrollAdjustment = session.shared;
            session.shared.connectObject('notify::value', view._onScrollAdjustmentChanged.bind(view), view);
            view._updateWorkspacesState();
            view.queue_relayout();
        }
        record.local = null;
    }

    _updateSelection() {
        const session = this._session;
        if (!session || session.gesture) return;
        const selected = this._resolver.resolve();
        if (!session.records.some(record => record.index === selected)) return;
        if (session.navigation) {
            if (session.selected !== selected) session.navigation.select(selected);
            session.selected = selected;
            return;
        }
        for (const record of session.records) {
            if (record.index === selected) this._unpin(record, session);
            else this._pin(record, session);
        }
        session.selected = selected;
        for (const record of session.records) record.thumbnails?.updateIndicator();
    }

    get selectedMonitor() {
        return this._lifecycle?.forcedMonitor ?? this._session?.selected ?? null;
    }

    get insertingWorkspace() {
        return this._session?.inserting ?? false;
    }

    shiftWorkspaceOrder(monitor, shift, inactive = true) {
        const workspaces = this._workspaces();
        for (const [index, order] of this._orders) {
            if ((index !== monitor) === inactive) {
                this._session?.records.find(record => record.index === index)?.thumbnails?.geometry.shift(shift, workspaces);
                order.shift(shift, workspaces);
            }
        }
        this._session?.navigation?.refresh();
        for (const record of this._session?.records ?? []) record.thumbnails?.refresh();
    }

    syncLogicalOrders() {
        if (!this._lifecycle) return;
        this._orders = new Map([...this._lifecycle.stacks.values()]
            .filter(stack => stack.index !== null).map(stack => [stack.index, stack.order]));
        for (const record of this._session?.records ?? []) {
            const order = this._orders.get(record.index);
            if (!order) continue;
            record.order = order;
            if (record.thumbnails) record.thumbnails.order = order;
        }
        this._session?.navigation?.refresh();
    }

    syncActiveWorkspace() {
        const session = this._session;
        if (!session) return;
        if (session.navigation) {
            session.navigation.syncActive();
            return;
        }
        const active = global.workspace_manager.get_active_workspace_index();
        for (const record of session.records) {
            if (!record.pinned) continue;
            record.local.upper = Math.max(session.shared.upper, active + record.local.page_size);
            record.local.value = active;
            record.view._updateWorkspacesState();
            record.view.queue_relayout();
        }
        for (const record of session.records) record.thumbnails?.refresh();
    }

    // Shell recreates a preview when a window changes its physical workspace.
    // Skip that preview's entrance animation for our inactive-display moves;
    // the user has not opened a new window on that display.
    moveWithoutPreviewAnimation(window, target, move) {
        const session = this._session;
        const record = session?.records.find(item => item.index === window.get_monitor() && item.pinned);
        const workspace = session?.navigation
            ? record?.view?._workspaces.find(ws => ws.metaWorkspace === global.workspace_manager.get_workspace_by_index(target))
            : record?.view?._workspaces[target];
        if (!workspace) return move();

        const descriptor = Object.getOwnPropertyDescriptor(workspace, '_addWindowClone');
        const original = workspace._addWindowClone;
        let clone = null;
        let easeDescriptor = null;
        let easeWrapper = null;
        const restoreEase = () => {
            if (!clone || clone.ease !== easeWrapper) return;
            if (easeDescriptor) Object.defineProperty(clone, 'ease', easeDescriptor);
            else delete clone.ease;
        };
        const wrapper = function (...args) {
            const result = original.apply(this, args);
            if (args[0] !== window || !result) return result;
            clone = result;
            easeDescriptor = Object.getOwnPropertyDescriptor(clone, 'ease');
            const ease = clone.ease;
            easeWrapper = function (params) {
                if (params.scale_x === 1 && params.scale_y === 1) {
                    restoreEase();
                    return ease.call(this, {...params, duration: 0});
                }
                return ease.call(this, params);
            };
            clone.ease = easeWrapper;
            return clone;
        };
        workspace._addWindowClone = wrapper;
        try { return move(); }
        finally {
            restoreEase();
            if (workspace._addWindowClone === wrapper) {
                if (descriptor) Object.defineProperty(workspace, '_addWindowClone', descriptor);
                else delete workspace._addWindowClone;
            }
        }
    }

    stop() {
        const session = this._session;
        this._session = null;
        if (!session) return;
        session.projections?.stop();
        session.projections = null;
        session.navigation?.stop();
        session.navigation = null;
        if (session.motionId) global.stage.disconnect(session.motionId);
        for (const id of session.managerSignals) global.workspace_manager.disconnect(id);
        for (const record of session.records) {
            record.thumbnails?.stop();
            if (record.view) this._unpin(record, session);
            if (record.viewDestroyId && record.view)
                record.view.disconnect(record.viewDestroyId);
            if (record.hostDestroyId && record.host)
                record.host.disconnect(record.hostDestroyId);
            record.local = null;
        }
        session.overrides.clear();
        session.records = [];
        session.display = null;
        session.shared = null;
    }

    destroy() {
        for (const [object, id] of this._signals) object.disconnect(id);
        this._signals = [];
        this.stop();
        this._orders.clear();
    }
}
