// SPDX-License-Identifier: MIT
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import {adjustAnimationTime} from 'resource:///org/gnome/shell/misc/animationUtils.js';
import {WINDOW_ANIMATION_TIME} from 'resource:///org/gnome/shell/ui/workspaceAnimation.js';
import {MethodOverrides} from './methodOverrides.js';

// Mutter acknowledges the old switch in WindowManager's kill handler. Keep
// only its visual actors until the immediately following switch can reuse them.
export class KeyboardWorkspaceAnimation {
    constructor(controller, configuration, resolver, lifecycle = null) {
        this._controller = controller;
        this._configuration = configuration;
        this._resolver = resolver;
        this._lifecycle = lifecycle;
        this._overrides = new MethodOverrides();
        this._session = null;
        this._idle = 0;
    }

    enable() {
        const animation = this;
        this._overrides.add(this._controller, 'animateSwitch', original => function (from, to, direction, onComplete) {
            // Gesture settlement belongs to Shell and the monitor-pinning hook.
            if (this._switchData && this._switchData !== animation._session?.data)
                return original.call(this, from, to, direction, onComplete);
            animation._animate(from, to, onComplete);
        });
        this._overrides.add(this._controller, 'cancelSwitchAnimation', original => function () {
            const session = animation._session;
            if (!session || this._switchData !== session.data)
                return original.call(this);
            // WindowManager calls _switchWorkspaceDone() after this returns.
            // Do not invoke this request's completion a second time later.
            session.onComplete = null;
            animation._stopTimeline();
            animation._clearIdle();
            animation._idle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                animation._idle = 0;
                if (animation._session === session)
                    this._finishWorkspaceSwitch(session.data);
                return GLib.SOURCE_REMOVE;
            });
        });
        this._overrides.add(this._controller, '_finishWorkspaceSwitch', original => function (data) {
            const session = animation._session;
            let onComplete = null;
            if (session?.data === data) {
                animation._clearIdle();
                animation._stopTimeline();
                onComplete = session.onComplete;
                animation._session = null;
                this._swipeTracker.enabled = true;
            }
            const result = original.call(this, data);
            onComplete?.();
            return result;
        });
    }

    _animate(from, to, onComplete) {
        this._clearIdle();
        this._stopTimeline();
        const controller = this._controller;
        const manager = global.workspace_manager;
        const workspaces = Array.from({length: manager.get_n_workspaces()},
            (_, i) => manager.get_workspace_by_index(i));
        const vertical = manager.layout_rows === -1;
        const rtl = Clutter.get_default_text_direction() === Clutter.TextDirection.RTL;
        let session = this._session;
        const selected = this._configuration.automaticSwitchingIsEnabled()
            ? session?.monitorIndex ?? this._resolver.resolve() : null;
        const logical = selected !== null ? this._lifecycle?.orderForMonitor(selected)?.workspaces : null;
        // Keyboard targets can be physically sparse or wrap the global pool.
        // Render them in the same logical sequence used by desktop gestures.
        const projection = logical?.includes(workspaces[from]) && logical.includes(workspaces[to])
            ? logical : workspaces;
        // A changed workspace pool/layout invalidates the snapshot coordinates.
        if (session && (session.vertical !== vertical || session.rtl !== rtl ||
            session.monitorIndex !== selected || session.projection.length !== projection.length ||
            session.projection.some((workspace, i) => workspace !== projection[i]) ||
            session.workspaces.length !== workspaces.length ||
            session.workspaces.some((workspace, i) => workspace !== workspaces[i]))) {
            controller._finishWorkspaceSwitch(session.data);
            session = null;
        }
        if (!session) {
            const indices = projection.map(workspace => workspaces.indexOf(workspace));
            if (projection === workspaces && rtl && !vertical) indices.reverse();
            // Include subsequent destinations now; a two-workspace snapshot
            // cannot retarget A -> B -> C without rebuilding its actors.
            controller._prepareWorkspaceSwitch(indices);
            const data = controller._switchData;
            const monitorIndex = data.monitors.some(group => group.index === selected) ? selected : null;
            session = {data, workspaces, projection: [...projection], vertical, rtl, monitorIndex,
                records: [], timeline: null, onComplete: null};
            this._session = session;
            for (const group of data.monitors) {
                const stationary = monitorIndex !== null && group.index !== monitorIndex;
                // The global switch has already shifted the other monitor's
                // windows into `to`. Keep that snapshot fixed across repeats;
                // animating its prebuilt future slots can expose stale clones.
                group.progress = group.getWorkspaceProgress(workspaces[stationary ? to : from]);
                if (stationary) continue;
                session.records.push({group, velocity: null});
            }
        }
        controller._swipeTracker.enabled = false;
        session.data.inProgress = true;
        session.onComplete = onComplete;
        let duration = Math.max(0, Math.floor(adjustAnimationTime(WINDOW_ANIMATION_TIME)));
        for (const record of session.records) {
            record.from = record.group.progress;
            record.target = record.group.getWorkspaceProgress(workspaces[to]);
            const points = record.group.getSnapPoints();
            record.min = Math.min(...points);
            record.max = Math.max(...points);
            // Initial motion is exactly Shell's ease-out cubic. Interruptions
            // carry its current derivative, not a freshly accelerated curve.
            record.initialVelocity = record.velocity ??
                (duration ? 3 * (record.target - record.from) / duration : 0);
        }
        for (const record of session.records) {
            const v = record.initialVelocity;
            if (!v) continue;
            const delta = record.target - record.from;
            const boundary = v > 0 ? record.max - record.from : record.from - record.min;
            const distance = delta * v > 0 ? Math.min(Math.abs(delta), boundary) : boundary;
            // A cubic Bezier's first control point is from + velocity*T/3.
            // Shorten T to keep that point in bounds without changing velocity.
            if (distance <= 0) record.initialVelocity = 0;
            else duration = Math.min(duration, 3 * distance / Math.abs(v));
        }
        duration = Math.floor(duration);
        for (const record of session.records) record.velocity = record.initialVelocity;
        if (duration < 1 || !session.records.length) {
            for (const record of session.records) record.group.progress = record.target;
            controller._finishWorkspaceSwitch(session.data);
            return;
        }
        const timeline = new Clutter.Timeline({actor: session.records[0].group, duration});
        session.timeline = timeline;
        session.frameId = timeline.connect('new-frame', (_timeline, elapsed) => {
            const t = Math.min(1, elapsed / duration);
            for (const record of session.records) {
                const delta = record.target - record.from;
                const tangent = record.initialVelocity * duration;
                const position = record.from + delta * (3 * t * t - 2 * t * t * t) +
                    tangent * t * (1 - t) * (1 - t);
                record.velocity = (6 * delta * t * (1 - t) +
                    tangent * (1 - 4 * t + 3 * t * t)) / duration;
                record.group.progress = Math.max(record.min, Math.min(record.max, position));
            }
        });
        session.completeId = timeline.connect('completed', () => {
            if (this._session === session)
                controller._finishWorkspaceSwitch(session.data);
        });
        timeline.start();
    }

    _clearIdle() {
        if (this._idle) GLib.source_remove(this._idle);
        this._idle = 0;
    }

    _stopTimeline() {
        const session = this._session;
        if (!session?.timeline) return;
        session.timeline.disconnect(session.frameId);
        session.timeline.disconnect(session.completeId);
        session.timeline.stop();
        session.timeline = null;
    }

    cancel() {
        if (this._session)
            this._controller._finishWorkspaceSwitch(this._session.data);
    }

    get selectedMonitor() {
        return this._session?.monitorIndex ?? null;
    }

    destroy() {
        this.cancel();
        this._clearIdle();
        this._overrides.clear();
        this._controller = null;
        this._configuration = null;
        this._resolver = null;
        this._lifecycle = null;
    }
}
