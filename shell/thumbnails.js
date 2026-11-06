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
import {ThumbnailState} from 'resource:///org/gnome/shell/ui/workspaceThumbnail.js';
import {MethodOverrides} from './methodOverrides.js';
import {OverviewThumbnailGeometry} from './thumbnailGeometry.js';

// The compositor owns global workspaces. Compensation rotates their windows,
// so each monitor needs an explicit logical order for its overview thumbnails.
// Keep workspace objects (not indices) so pruning does not retarget a slot.
export class MonitorWorkspaceOrder {
    constructor(workspaces) {
        this.workspaces = [...workspaces];
    }

    reconcile(workspaces) {
        this.workspaces = this.workspaces.filter(workspace => workspaces.includes(workspace));
        for (const workspace of workspaces) {
            if (!this.workspaces.includes(workspace)) this.workspaces.push(workspace);
        }
    }

    shift(amount, workspaces) {
        this.reconcile(workspaces);
        const count = workspaces.length;
        if (!count) return;
        this.workspaces = this.workspaces.map(workspace =>
            workspaces[((workspaces.indexOf(workspace) + amount) % count + count) % count]);
    }
}

// Keep the native thumbnail actors and their Meta.Workspace targets. Reordering
// those actors preserves native clicks, XDND activation and ordinary drops.
// Only insertion translates a visual slot back to a compositor workspace.
export class OverviewThumbnails {
    constructor(isolation, session, record, box, order) {
        this.isolation = isolation;
        this.session = session;
        this.record = record;
        this.box = box;
        this.order = order;
        this.nativeDrop = false;
        this.originalAdjustment = box._scrollAdjustment;
        this._overrides = new MethodOverrides();
        record.thumbnails = this;
        this.geometry = new OverviewThumbnailGeometry(this);
        this.destroyId = box.connect('destroy', () => {
            this.projection?.discardBox();
            this.geometry.stop(true);
            this.geometry = null;
            this._overrides.forgetObject(this.box);
            this.box = null;
            this.stop();
        });
        this.local = new St.Adjustment({actor: box, lower: 0,
            upper: session.shared.upper, page_size: 1, value: session.shared.value});
        box._scrollAdjustment = this.local;
        const wrap = (name, factory) => this._overrides.add(box, name, factory);
        wrap('_updateIndicator', () => () => this.updateIndicator());
        for (const name of ['_activateThumbnailAtPoint', 'handleDragOver']) {
            wrap(name, original => (...args) => {
                this.isolation._updateSelection();
                return original.apply(box, args);
            });
        }
        wrap('addThumbnails', original => (...args) => {
            if (this.projection?.projected) return this.projection.withPhysical(() => box.addThumbnails(...args));
            if (box._thumbnails.length) this.geometry.freeze();
            const result = original.apply(box, args);
            this.refresh();
            return result;
        });
        wrap('removeThumbnails', original => (...args) => {
            if (this.projection?.projected) return this.projection.withPhysical(() => box.removeThumbnails(...args));
            this.geometry.freeze();
            // Shell's bound _workspacesChanged callback assumes physical order.
            // Identify removed objects instead of trusting its positional index.
            const valid = box._thumbnails.filter(t => t.state <= ThumbnailState.NORMAL);
            const workspaces = this.isolation._workspaces();
            for (let i = valid.length - 1; i >= 0; i--) {
                if (!workspaces.includes(valid[i].metaWorkspace))
                    original.call(box, i, 1);
            }
            this.refresh();
        });
        wrap('_queueUpdateStates', original => (...args) => {
            this.updateIndicator(false);
            return original.apply(box, args);
        });
        wrap('acceptDrop', original => (...args) => {
            this.isolation._updateSelection();
            if (box._dropWorkspace !== -1 || box._dropPlaceholderPos === -1)
                return original.apply(box, args);
            const position = box._dropPlaceholderPos;
            const target = box._thumbnails[position]?.metaWorkspace;
            const workspaces = this.isolation._workspaces();
            const physicalPosition = workspaces.indexOf(target);
            if (physicalPosition < 0) return false;
            const insert = () => {
                const removing = box._thumbnails.map((thumbnail, index) => ({thumbnail, index}))
                    .filter(({thumbnail}) => thumbnail.state > ThumbnailState.NORMAL);
                // The native insertion implementation indexes _thumbnails by the
                // physical position throughout the call, including its animation.
                box._dropPlaceholderPos = physicalPosition;
                this.nativeDrop = true;
                session.insertion = {adapter: this, position: this.order.workspaces.indexOf(target)};
                box._thumbnails = box._thumbnails.filter(t => t.state <= ThumbnailState.NORMAL);
                box._thumbnails.sort((a, b) => workspaces.indexOf(a.metaWorkspace) - workspaces.indexOf(b.metaWorkspace));
                try { return original.apply(box, args); }
                finally {
                    session.insertion = null;
                    this.nativeDrop = false;
                    if (box._dropPlaceholderPos !== -1) box._dropPlaceholderPos = position;
                    for (const item of session.records) item.thumbnails?.refresh();
                    for (const {thumbnail, index} of removing)
                        box._thumbnails.splice(Math.min(index, box._thumbnails.length), 0, thumbnail);
                    this.updateIndicator();
                }
            };
            return this.projection ? this.projection.withPhysical(insert) : insert();
        });
        this.geometry.start();
        this.refresh();
    }

    refresh() {
        if (this.projection?.projected) return this.projection.withPhysical(() => this.refresh());
        this.order.reconcile(this.isolation._workspaces());
        if (!this.nativeDrop && !this.session.inserting) {
            // Leave actors undergoing removal in their existing slots until
            // GNOME's collapse animation destroys them.
            const valid = this.box._thumbnails.filter(t => t.state <= ThumbnailState.NORMAL);
            valid.sort((a, b) => this.order.workspaces.indexOf(a.metaWorkspace) -
                this.order.workspaces.indexOf(b.metaWorkspace));
            let index = 0;
            this.box._thumbnails = this.box._thumbnails.map(t =>
                t.state <= ThumbnailState.NORMAL ? valid[index++] : t);
        }
        this.projection?.refresh();
        this.geometry.refresh();
        this.updateIndicator();
    }

    position(index) {
        const workspace = global.workspace_manager.get_workspace_by_index(index);
        const thumbnails = this.projection?.visible() ?? this.box._thumbnails;
        const slot = thumbnails.findIndex(t => t.metaWorkspace === workspace);
        return Math.max(0, slot);
    }

    updateIndicator(queueStates = true) {
        const box = this.box;
        const active = this.position(global.workspace_manager.get_active_workspace_index());
        const value = this.session.shared.value;
        const lower = Math.floor(value), upper = Math.ceil(value);
        const logicalValue = this.record.local?.value ?? this.order.workspaces.indexOf(global.workspace_manager.get_workspace_by_index(global.workspace_manager.get_active_workspace_index()));
        const thumbnails = this.projection?.visible() ?? box._thumbnails;
        const logicalPosition = index => Math.max(0, thumbnails.findIndex(t => t.metaWorkspace === this.order.workspaces[index]));
        const logicalLower = Math.floor(logicalValue), logicalUpper = Math.ceil(logicalValue);
        const logicalMapped = logicalPosition(logicalLower) +
            (logicalPosition(logicalUpper) - logicalPosition(logicalLower)) * (logicalValue - logicalLower);
        const mapped = this.session.navigation ? logicalMapped : this.record.pinned ? active :
            this.position(lower) + (this.position(upper) - this.position(lower)) * (value - lower);
        this.local.upper = Math.max(1, thumbnails.length);
        this.local.value = mapped;
        box._animatingIndicator = !this.record.pinned && Math.abs(mapped - active) > 0.0001;
        if (queueStates && !box._animatingIndicator) box._queueUpdateStates();
        box.queue_relayout();
    }

    stop() {
        const box = this.box;
        this.projection?.stop();
        this.geometry?.stop();
        this.geometry = null;
        if (box) box.disconnect(this.destroyId);
        this._overrides.clear();
        if (box) {
            if (box._scrollAdjustment === this.local)
                box._scrollAdjustment = this.originalAdjustment;
            // Native collapse callbacks retain the removed actor. Preserve its
            // slot while restoring physical order among surviving workspaces.
            const workspaces = this.isolation._workspaces();
            const valid = box._thumbnails.filter(t => t.state <= ThumbnailState.NORMAL)
                .sort((a, b) => workspaces.indexOf(a.metaWorkspace) - workspaces.indexOf(b.metaWorkspace));
            let index = 0;
            box._thumbnails = box._thumbnails.map(t =>
                t.state <= ThumbnailState.NORMAL ? valid[index++] : t);
            box._updateIndicator();
        }
        this.record.thumbnails = null;
        this.box = null;
        this.local = null;
        this.originalAdjustment = null;
        this.record = null;
        this.order = null;
        this.session = null;
        this.isolation = null;
    }
}
