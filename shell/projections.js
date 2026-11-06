/* SPDX-License-Identifier: MIT */
// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import Clutter from 'gi://Clutter';
import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import {MethodOverrides} from './methodOverrides.js';

// Keep Shell's complete actor arrays for native membership and animation
// bookkeeping. Project only rendering, sizing and pointer targeting into the
// monitor's logical subset. In particular, an unclaimed physical workspace is
// not an extra logical workspace on every display.
export class OverviewWorkspaceProjections {
    constructor() {
        this.injections = new InjectionManager();
        this.methods = new MethodOverrides();
        this.views = new WeakMap();
        this.thumbnails = new WeakMap();
        this.installed = new Map();
        this.adapters = new Set();
        this.token = {owner: this};
    }

    _inject(object, name, kind) {
        const prototype = Object.getPrototypeOf(object);
        if (!this.installed.has(prototype)) this.installed.set(prototype, new Set());
        const names = this.installed.get(prototype);
        if (names.has(name)) return;
        names.add(name);
        const token = this.token;
        this.injections.overrideMethod(prototype, name, original => function (...args) {
            const owner = token.owner;
            const projection = owner?.[kind].get(this);
            if (!projection) return original.apply(this, args);
            return projection.withProjection(() => original.apply(this, args));
        });
    }

    addView(record) {
        const view = record.view;
        const projection = {withProjection(callback) {
            const physical = view._workspaces;
            view._workspaces = record.order.workspaces.map(workspace => physical.find(actor => actor.metaWorkspace === workspace)).filter(Boolean);
            try { return callback(); }
            finally { view._workspaces = physical; }
        }};
        this.views.set(view, projection);
        this._inject(view, 'vfunc_allocate', 'views');
        this.methods.add(view, '_updateWorkspacesState', original => function (...args) {
            return projection.withProjection(() => original.apply(this, args));
        });
        // This GNOME 51 helper reads the global count even while its caller's
        // array has been projected; use the local count for fit-all geometry.
        this.methods.add(view, '_getFirstFitAllWorkspaceBox', () => function (box, spacing, vertical) {
            const count = this._workspaces.length;
            const [width, height] = box.get_size();
            const [workspace] = this._workspaces;
            const result = new Clutter.ActorBox();
            if (!workspace) return result;
            let [x1, y1] = box.get_origin();
            if (vertical) {
                const available = height - spacing * (count + 1);
                let workspaceHeight = available / count;
                const [, workspaceWidth] = workspace.get_preferred_width(workspaceHeight);
                y1 = spacing;
                if (workspaceWidth > width) {
                    [, workspaceHeight] = workspace.get_preferred_height(width);
                    y1 += Math.max((available - workspaceHeight * count) / 2, 0);
                }
                result.set_size(width, workspaceHeight);
            } else {
                const available = width - spacing * (count + 1);
                let workspaceWidth = available / count;
                const [, workspaceHeight] = workspace.get_preferred_height(workspaceWidth);
                x1 = spacing;
                if (workspaceHeight > height) {
                    [, workspaceWidth] = workspace.get_preferred_width(height);
                    x1 += Math.max((available - workspaceWidth * count) / 2, 0);
                }
                result.set_size(workspaceWidth, height);
            }
            result.set_origin(x1, y1);
            return result;
        });
    }

    addThumbnails(adapter) {
        const projection = new ThumbnailProjection(this, adapter);
        adapter.projection = projection;
        this.adapters.add(projection);
        this.thumbnails.set(adapter.box, projection);
        for (const name of ['vfunc_allocate', 'vfunc_get_preferred_width', 'vfunc_get_preferred_height'])
            this._inject(adapter.box, name, 'thumbnails');
        for (const name of ['_activateThumbnailAtPoint', 'handleDragOver', 'acceptDrop', '_getPlaceholderTarget', '_withinWorkspace']) {
            projection.methods.add(adapter.box, name, original => function (...args) {
                return projection.withProjection(() => original.apply(this, args));
            });
        }
        adapter.refresh();
    }

    forgetView(view) { this.methods.forgetObject(view); this.views.delete(view); }

    stop() {
        this.token.owner = null;
        this.injections.clear();
        this.methods.clear();
        for (const projection of this.adapters) projection.stop();
        this.adapters.clear();
        this.views = new WeakMap();
        this.thumbnails = new WeakMap();
        this.installed.clear();
    }
}

class ThumbnailProjection {
    constructor(owner, adapter) {
        this.owner = owner;
        this.adapter = adapter;
        this.box = adapter.box;
        this.methods = new MethodOverrides();
        this.projected = false;
        this.physical = null;
        this.visibility = new WeakMap();
    }

    visible(physical = this.physical ?? this.box._thumbnails) {
        const order = this.adapter.order.workspaces;
        const visible = order.map(workspace => physical.find(actor => actor.metaWorkspace === workspace)).filter(Boolean);
        for (const actor of physical) {
            if (!visible.includes(actor) && this.adapter.geometry.pin?.slots.has(actor.metaWorkspace)) visible.push(actor);
        }
        return visible;
    }

    withProjection(callback) {
        if (this.projected || !this.adapter) return callback();
        const box = this.box;
        this.physical = box._thumbnails;
        box._thumbnails = this.visible(this.physical);
        this.projected = true;
        try { return callback(); }
        finally {
            if (this.box === box) {
                box._thumbnails = this.physical;
                this.physical = null;
                this.projected = false;
            }
        }
    }

    withPhysical(callback) {
        if (!this.projected) return callback();
        const box = this.box;
        box._thumbnails = this.physical;
        this.projected = false;
        try { return callback(); }
        finally {
            if (this.box === box) {
                this.physical = box._thumbnails;
                box._thumbnails = this.visible(this.physical);
                this.projected = true;
            }
        }
    }

    refresh() {
        const visible = new Set(this.visible());
        for (const actor of this.physical ?? this.box._thumbnails) {
            if (!this.visibility.has(actor)) this.visibility.set(actor, actor.visible);
            actor.visible = visible.has(actor) && this.visibility.get(actor);
            const geometryEntry = this.adapter.geometry.actors.get(actor);
            if (geometryEntry) geometryEntry.visible = actor.visible;
        }
    }

    discardBox() {
        this.owner.thumbnails.delete(this.box);
        this.methods.forgetObject(this.box);
        this.box = null;
        this.stop();
    }

    stop() {
        const box = this.box;
        this.methods.clear();
        if (box) {
            // Clicking an active thumbnail can synchronously close overview.
            // Restore full membership before releasing this projection.
            if (this.projected) box._thumbnails = this.physical;
            for (const actor of box._thumbnails) {
                actor.visible = this.visibility.get(actor) ?? true;
                const geometryEntry = this.adapter.geometry.actors.get(actor);
                if (geometryEntry) geometryEntry.visible = actor.visible;
            }
            box.queue_relayout();
            this.owner.thumbnails.delete(box);
        }
        this.owner.adapters.delete(this);
        this.adapter.projection = null;
        this.owner = null;
        this.adapter = null;
        this.box = null;
        this.physical = null;
        this.projected = false;
    }
}
