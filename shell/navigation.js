// SPDX-License-Identifier: MIT
// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as SwipeTracker from 'resource:///org/gnome/shell/ui/swipeTracker.js';
import {MethodOverrides} from './methodOverrides.js';

// GNOME 51's overview callbacks close over physical indices. Keep the shared
// Shell adjustment physical, but render each monitor in its own logical space.
// In particular, interpolating physical N-1 -> 0 cannot describe one logical
// step: gesture progress and its final Meta.Workspace must be mapped separately.
export class OverviewNavigation {
    constructor(isolation, session) {
        this.isolation = isolation;
        this.session = session;
        this.overrides = new MethodOverrides();
        this.managerSignals = [];
        this.originalTracker = session.display._swipeTracker;
        this.originalTrackerEnabled = this.originalTracker.enabled;
        this.tracker = null;
        this.generation = 0;
        this.actorSignalIds = [];
        this.actorOwners = [];
        this.actorActions = [];
        this.trackerSignalIds = [];
    }

    start() {
        const {session} = this;
        const manager = global.workspace_manager;
        // Finish ownership transfer before exposing any logical adjustment.
        // Disabling an in-flight native tracker can enqueue its old completion.
        this.originalTracker.enabled = false;
        session.shared.remove_transition('value');
        if (session.display._gestureActive) session.display._endTouchGesture();
        for (const record of session.records) {
            const {view} = record;
            const local = new St.Adjustment({actor: view, lower: 0,
                upper: manager.get_n_workspaces(), page_size: 1,
                step_increment: 1, page_increment: 1});
            record.local = local;
            session.shared.disconnectObject(view);
            view._scrollAdjustment = local;
            record.navigationAttached = true;
            local.connectObject('notify::value', () => {
                view._updateWorkspacesState();
                view.queue_relayout();
                record.thumbnails?.updateIndicator();
            }, view);

            // These two native callbacks were bound during _init; changing the
            // methods afterwards would leave the old physical-index callback
            // live. Their owner is only used for workspace membership/reorder.
            manager.disconnectObject(view);
            record.managerDetached = true;
            const update = view._updateWorkspaces;
            this.managerSignals.push(manager.connect('notify::n-workspaces', () => {
                this.cancel();
                this.physicalOrder(record);
                try { update.call(view); }
                finally { this.refreshRecord(record, true); }
            }));
            this.managerSignals.push(manager.connect('workspaces-reordered', () => {
                this.cancel();
                this.refreshRecord(record, true);
            }));
            this.overrides.add(view, 'getActiveWorkspace', () => () =>
                view._workspaces.find(ws => ws.metaWorkspace === manager.get_active_workspace()));
            this.overrides.add(view, '_updateVisibility', () => () => {
                const active = this.activePosition(record);
                const showAll = view._animating || view._gestureActive || view._fitModeAdjustment.value !== 0;
                view._workspaces.forEach(ws => {
                    const i = record.order.workspaces.indexOf(ws.metaWorkspace);
                    ws.visible = i >= 0 && (showAll || Math.abs(i - active) <= 1);
                });
            });
            this.overrides.add(view, '_scrollToActive', () => () => {
                if (session.gesture) return;
                this.scrollToActive(record, !record.pinned);
            });
            this.refreshRecord(record, true);
        }

        // Use an owned tracker: Shell connected its callbacks with .bind() and
        // did not retain their signal IDs. Do not block unknown third-party
        // listeners or mutate the global workspace manager to fool those binds.
        const actor = Main.layoutManager.overviewGroup;
        const connections = new MethodOverrides();
        // GNOME 51 ScrollGesture uses actor.connect(), and SwipeTracker.destroy
        // does not disconnect it. Capture only our constructor's connection.
        connections.add(actor, 'connect', original => (...args) => {
            const id = original.apply(actor, args);
            if (args[0] === 'scroll-event') this.actorSignalIds.push([actor, id]);
            return id;
        });
        connections.add(actor, 'connectObject', original => (...args) => {
            this.actorOwners.push([actor, args.at(-1)]);
            return original.apply(actor, args);
        });
        connections.add(actor, 'add_action_full', original => (...args) => {
            this.actorActions.push(args.at(-1));
            return original.apply(actor, args);
        });
        try {
            this.tracker = new SwipeTracker.SwipeTracker(actor, this.originalTracker.orientation,
                Shell.ActionMode.OVERVIEW, {allowDrag: false, name: 'Orchard overview workspace tracker'});
        } finally {
            connections.clear();
        }
        this.tracker.allowLongSwipes = this.originalTracker.allowLongSwipes;
        this.tracker.scrollModifiers = this.originalTracker.scrollModifiers;
        session.display._swipeTracker = this.tracker;
        for (const [signal, callback] of [
            ['begin', (_tracker, monitor) => this.begin(monitor)],
            ['update', (_tracker, progress) => this.update(progress)],
            ['end', (_tracker, duration, progress) => this.end(duration, progress)],
        ]) this.trackerSignalIds.push(this.tracker.connect(signal, callback));
        session.display._updateSwipeTracker();
        this.overrides.add(session.display, '_moveToWorkspace', original => function (direction) {
            return session.navigation.withNeighbors(() => original.call(this, direction));
        });
        this.overrides.add(Main.wm, 'handleWorkspaceScroll', original => function (...args) {
            return session.navigation.withNeighbors(() => original.apply(this, args));
        });
    }

    activePosition(record) {
        return Math.max(0, record.order.workspaces.indexOf(global.workspace_manager.get_active_workspace()));
    }

    physicalOrder(record) {
        const workspaces = this.isolation._workspaces();
        record.view?._workspaces.sort((a, b) => workspaces.indexOf(a.metaWorkspace) - workspaces.indexOf(b.metaWorkspace));
    }

    refreshRecord(record, snap = false) {
        if (!record.view) return;
        record.order.reconcile(this.isolation._workspaces());
        record.view._workspaces.sort((a, b) => record.order.workspaces.indexOf(a.metaWorkspace) -
            record.order.workspaces.indexOf(b.metaWorkspace));
        record.view._workspaces.forEach((ws, i) => record.view.set_child_at_index(ws, i));
        record.local.upper = Math.max(1, record.order.workspaces.length);
        if (snap || record.pinned) {
            record.local.remove_transition('value');
            record.local.value = this.activePosition(record);
        }
        record.view._updateWorkspacesState();
        record.view._updateVisibility();
        record.view._raiseActiveWorkspace();
        record.view.queue_relayout();
        record.thumbnails?.refresh();
    }

    refresh() {
        for (const record of this.session.records) {
            this.refreshRecord(record);
            if (!this.session.gesture && !record.pinned) this.scrollToActive(record, true);
        }
    }

    syncActive() {
        // Thumbnail/XDND activation or an external shortcut wins over an old
        // gesture target. Our own commit keeps its monitor locked until finish.
        if (this.session.gesture && !this.committing) this.cancel();
        this.refresh();
    }

    scrollToActive(record, animate) {
        const {view, local} = record;
        local.remove_transition('value');
        view._animating = animate;
        view._updateVisibility();
        const value = this.activePosition(record);
        if (!animate) {
            local.value = value;
            return;
        }
        local.ease(value, {duration: 250, mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                view._animating = false;
                view._updateVisibility();
            }});
    }

    select(selected) {
        for (const record of this.session.records) {
            record.pinned = record.index !== selected;
            if (!record.pinned) record.thumbnails?.geometry.unfreeze();
            // Selection changes must not resume a half-finished animation on
            // the monitor the pointer just left.
            record.local.remove_transition('value');
            record.view._animating = false;
            record.local.value = this.activePosition(record);
            record.view._updateVisibility();
        }
    }

    begin(monitor) {
        const {display} = this.session;
        if (display._workspacesOnlyOnPrimary && monitor !== display._primaryIndex) return;
        this.cancel(false);
        this.isolation._updateSelection();
        const record = this.session.records.find(item => item.index === this.session.selected);
        if (!record) return;
        for (const item of this.session.records) item.thumbnails?.geometry.freeze();
        this.gestureRecord = record;
        this.gestureWorkspaces = [...record.order.workspaces];
        this.session.gesture = true;
        display._gestureActive = true;
        this.session.shared.remove_transition('value');
        record.local.remove_transition('value');
        record.host.startTouchGesture();
        const progress = record.local.value;
        const distance = global.workspace_manager.layout_rows === -1 ? display.height : display.width;
        this.tracker.confirmSwipe(distance, this.gestureWorkspaces.map((_, i) => i), progress, Math.round(progress));
    }

    update(progress) {
        if (!this.gestureRecord) return;
        this.gestureRecord.local.value = progress;
    }

    end(duration, progress) {
        const record = this.gestureRecord;
        if (!record) return;
        const target = this.gestureWorkspaces[Math.round(progress)];
        if (!target || !this.isolation._workspaces().includes(target)) { this.cancel(); return; }
        const generation = ++this.generation;
        const {session} = this;
        record.local.ease(progress, {duration, mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                if (generation !== this.generation || !this.isolation._workspaces().includes(target)) return;
                // Keep the chosen monitor locked while activation synchronously
                // rotates the inactive monitor's windows and logical mapping.
                this.committing = true;
                try {
                    if (!target.active) target.activate(global.get_current_time());
                } finally {
                    this.committing = false;
                }
                // Activation can synchronously close/rebuild the overview.
                if (this.session === session) {
                    this.session.shared.remove_transition('value');
                    this.session.shared.value = global.workspace_manager.get_active_workspace_index();
                    this.finish();
                }
            }});
    }

    finish() {
        const record = this.gestureRecord;
        this.gestureRecord = null;
        this.gestureWorkspaces = null;
        this.session.gesture = false;
        this.session.display._gestureActive = false;
        if (record?.view) record.host.endTouchGesture();
        if (this.isolation._session === this.session) this.isolation._updateSelection();
    }

    cancel(resetTracker = true) {
        ++this.generation;
        if (!this.gestureRecord) return;
        this.gestureRecord.local.remove_transition('value');
        // A count/reorder or mode change invalidates the tracker's snap points.
        // Disable resets its recognizers; its synchronous end signal is ignored.
        const record = this.gestureRecord;
        this.gestureRecord = null;
        if (this.tracker && resetTracker) {
            const enabled = this.tracker.enabled;
            this.tracker.enabled = false;
            this.tracker.enabled = enabled;
        }
        this.gestureRecord = record;
        this.finish();
    }

    withNeighbors(action) {
        if (this.session.gesture) this.cancel();
        this.isolation._updateSelection();
        const record = this.session.records.find(item => item.index === this.session.selected);
        if (!record) return action();
        const workspace = global.workspace_manager.get_active_workspace();
        const hooks = new MethodOverrides();
        hooks.add(workspace, 'get_neighbor', original => direction => {
            const vertical = global.workspace_manager.layout_rows === -1;
            const rtl = Clutter.get_default_text_direction() === Clutter.TextDirection.RTL;
            let step;
            if (vertical && direction === Meta.MotionDirection.UP) step = -1;
            else if (vertical && direction === Meta.MotionDirection.DOWN) step = 1;
            else if (!vertical && direction === Meta.MotionDirection.LEFT) step = rtl ? 1 : -1;
            else if (!vertical && direction === Meta.MotionDirection.RIGHT) step = rtl ? -1 : 1;
            else return original.call(workspace, direction);
            const position = record.order.workspaces.indexOf(workspace);
            return record.order.workspaces[position + step] ?? workspace;
        });
        try { return action(); }
        finally { hooks.clear(); }
    }

    stop() {
        this.cancel();
        const {session} = this;
        const manager = global.workspace_manager;
        for (const id of this.managerSignals) manager.disconnect(id);
        this.managerSignals = [];
        session.shared.remove_transition('value');
        session.shared.value = manager.get_active_workspace_index();
        this.overrides.clear();
        for (const record of session.records) {
            if (!record.navigationAttached) continue;
            record.local.remove_transition('value');
            if (record.view) {
                const {view} = record;
                record.local.disconnectObject(view);
                this.physicalOrder(record);
                view._workspaces.forEach((ws, i) => view.set_child_at_index(ws, i));
                if (view._scrollAdjustment === record.local) {
                    view._scrollAdjustment = session.shared;
                    session.shared.connectObject('notify::value', view._onScrollAdjustmentChanged.bind(view), view);
                }
                if (record.managerDetached) {
                    manager.connectObject('notify::n-workspaces', view._updateWorkspaces.bind(view),
                        'workspaces-reordered', () => {
                            const workspaces = Array.from({length: manager.get_n_workspaces()},
                                (_, i) => manager.get_workspace_by_index(i));
                            view._workspaces.sort((a, b) => workspaces.indexOf(a.metaWorkspace) - workspaces.indexOf(b.metaWorkspace));
                            view._workspaces.forEach((ws, i) => view.set_child_at_index(ws, i));
                        }, view);
                }
                view._animating = false;
                view._gestureActive = false;
                view._updateWorkspacesState();
                view._updateVisibility();
                view.queue_relayout();
            }
            record.pinned = false;
            record.local = null;
        }
        if (session.display._swipeTracker === this.tracker || session.display._swipeTracker === this.originalTracker) {
            session.display._swipeTracker = this.originalTracker;
            this.originalTracker.enabled = this.originalTrackerEnabled;
            session.display._updateTrackerOrientation();
            session.display._updateSwipeTracker();
        }
        // TouchpadSwipeGesture.destroy disconnects global.stage, although the
        // overview tracker connected to overviewGroup. Also handle a partially
        // constructed tracker whose constructor threw before returning it.
        for (const [actor, owner] of this.actorOwners) actor.disconnectObject(owner);
        this.actorOwners = [];
        if (this.tracker) {
            for (const id of this.trackerSignalIds) this.tracker.disconnect(id);
            this.tracker.enabled = false;
            this.tracker.destroy();
        }
        for (const action of this.actorActions) action.actor?.remove_action(action);
        this.actorActions = [];
        this.trackerSignalIds = [];
        for (const [actor, id] of this.actorSignalIds) actor.disconnect(id);
        this.actorSignalIds = [];
        this.tracker = null;
        this.originalTracker = null;
        this.session = null;
        this.isolation = null;
    }
}
