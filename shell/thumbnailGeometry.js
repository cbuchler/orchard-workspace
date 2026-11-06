// SPDX-License-Identifier: MIT
// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import {ThumbnailState} from 'resource:///org/gnome/shell/ui/workspaceThumbnail.js';
import {MethodOverrides} from './methodOverrides.js';

// Dynamic workspaces are global, but an inactive monitor's strip must not
// recenter or shrink when another monitor occupies the trailing empty slot.
// Keep its allocated logical slots until it is selected again. The compositor
// and native thumbnail membership continue updating throughout this interval.
export class OverviewThumbnailGeometry {
    constructor(adapter) {
        this.adapter = adapter;
        this.box = adapter.box;
        this.hooks = new MethodOverrides();
        this.actors = new Map();
        this.pin = null;
        this.allocation = null;
        this.indicatorAllocation = null;
    }

    start() {
        const box = this.box;
        this.hooks.add(box, 'set_allocation', original => (...args) => {
            if (this.pin) args[0] = this.pin.allocation.copy();
            else this.allocation = args[0].copy();
            return original.apply(box, args);
        });
        this.hooks.add(box._indicator, 'allocate', original => (...args) => {
            if (this.pin?.indicatorAllocation) args[0] = this.pin.indicatorAllocation.copy();
            else this.indicatorAllocation = args[0].copy();
            return original.apply(box._indicator, args);
        });
        this.hooks.add(box, '_updateStates', original => (...args) => {
            if (this.pin) {
                // Retain removed empty slots and keep new slots collapsed. In
                // particular, native removal completion must not destroy the
                // actor that still draws an inactive monitor's empty slot.
                box._updateStateId = 0;
                return;
            }
            return original.apply(box, args);
        });
        this.refresh();
    }

    _track(thumbnail) {
        if (this.actors.has(thumbnail)) return;
        const entry = {thumbnail, allocation: null, scale: null,
            visible: thumbnail.visible, destroyId: 0};
        this.actors.set(thumbnail, entry);
        if (thumbnail.has_allocation()) entry.allocation = thumbnail.get_allocation_box().copy();
        entry.scale = [thumbnail._viewport.scale_x, thumbnail._viewport.scale_y];
        entry.destroyId = thumbnail.connect('destroy', () => {
            this.hooks.forgetObject(thumbnail);
            this.actors.delete(thumbnail);
            if (this.pin) {
                this.pin.pausedTransitions = this.pin.pausedTransitions.filter(({actor}) => actor !== thumbnail);
            }
        });
        this.hooks.add(thumbnail, 'setScale', original => (...args) => {
            const slot = this.pin?.slots.get(thumbnail.metaWorkspace);
            if (slot?.scale) args = slot.scale;
            entry.scale = [...args];
            return original.apply(thumbnail, args);
        });
        this.hooks.add(thumbnail, 'handleDragOverInternal', original => (...args) => {
            if (!this.adapter.isolation._workspaces().includes(thumbnail.metaWorkspace))
                return DND.DragMotionResult.CONTINUE;
            return original.apply(thumbnail, args);
        });
        this.hooks.add(thumbnail, 'allocate', original => (...args) => {
            const slot = this.pin?.slots.get(thumbnail.metaWorkspace);
            if (slot) args[0] = slot.allocation.copy();
            entry.allocation = args[0].copy();
            return original.apply(thumbnail, args);
        });
    }

    freeze() {
        if (this.pin || !this.adapter.record.pinned) return;
        // Opening/closing the overview is a deliberate animation on every
        // display. A stationary layout can only be captured once it exists.
        if (this.adapter.record.view?._overviewAdjustment.getStateTransitionParams().transitioning) return;
        const allocation = this.allocation ??
            (this.box.has_allocation() ? this.box.get_allocation_box() : null);
        if (!allocation) return;
        const slots = new Map();
        for (const entry of this.actors.values()) {
            if (!entry.allocation || !entry.thumbnail.visible || entry.thumbnail.state === ThumbnailState.DESTROYED) continue;
            const {thumbnail} = entry;
            slots.set(thumbnail.metaWorkspace, {allocation: entry.allocation.copy(), scale: entry.scale,
                visual: [thumbnail.scale_x, thumbnail.scale_y, thumbnail.opacity]});
        }
        if (!slots.size) return;
        const indicatorAllocation = this.indicatorAllocation ??
            (this.box._indicator.has_allocation() ? this.box._indicator.get_allocation_box() : null);
        this.pin = {allocation: allocation.copy(), indicatorAllocation: indicatorAllocation?.copy(), slots,
            pausedTransitions: []};
        for (const [actor, properties] of [[this.box, ['scale']],
            ...[...this.actors.keys()].map(actor => [actor, ['slide-position', 'collapse-fraction']])]) {
            for (const property of properties) {
                const transition = actor.get_transition(property);
                if (!transition || !transition.is_playing()) continue;
                transition.pause();
                this.pin.pausedTransitions.push({actor, property, transition});
            }
        }
    }

    shift(amount, workspaces) {
        this.freeze();
        if (!this.pin) return;
        const count = workspaces.length;
        this.pin.slots = new Map([...this.pin.slots].map(([workspace, geometry]) => {
            const index = workspaces.indexOf(workspace);
            // A removed empty slot remains a visual placeholder until unpin.
            return [index < 0 ? workspace : workspaces[((index + amount) % count + count) % count], geometry];
        }));
    }

    remap(mapping) {
        if (!this.pin) return;
        this.pin.slots = new Map([...this.pin.slots].map(([workspace, geometry]) =>
            [mapping.get(workspace) ?? workspace, geometry]));
    }

    refresh() {
        for (const thumbnail of this.box._thumbnails) this._track(thumbnail);
        if (!this.pin) return;
        for (const entry of this.actors.values()) {
            const thumbnail = entry.thumbnail;
            const slot = this.pin.slots.get(thumbnail.metaWorkspace);
            const represented = !!slot;
            thumbnail.visible = represented && entry.visible;
            if (represented && thumbnail.state < ThumbnailState.NORMAL) {
                // Compensation may remap an established logical slot onto a
                // newly appended physical workspace. It is not a new visual
                // slot, so do not replay its native entrance animation.
                thumbnail.remove_transition('slide-position');
                thumbnail.remove_transition('collapse-fraction');
                this.box._setThumbnailState(thumbnail, ThumbnailState.NORMAL);
                thumbnail.slide_position = 0;
                thumbnail.collapse_fraction = 0;
                entry.savedVisual = [1, 1, 255];
            }
            if (slot) {
                entry.savedVisual ??= [thumbnail.scale_x, thumbnail.scale_y, thumbnail.opacity];
                [thumbnail.scale_x, thumbnail.scale_y, thumbnail.opacity] = slot.visual;
            }
        }
    }

    unfreeze() {
        if (!this.pin) return;
        const {pausedTransitions} = this.pin;
        this.pin = null;
        for (const entry of this.actors.values()) {
            entry.thumbnail.visible = entry.visible;
            if (entry.savedVisual) {
                [entry.thumbnail.scale_x, entry.thumbnail.scale_y, entry.thumbnail.opacity] = entry.savedVisual;
                delete entry.savedVisual;
            }
        }
        for (const {actor, property, transition} of pausedTransitions) {
            if (actor !== this.box && !this.actors.has(actor)) continue;
            if (actor.get_transition(property) === transition) transition.start();
        }
        this.box._queueUpdateStates();
        this.box.queue_relayout();
    }

    stop(destroyed = false) {
        if (destroyed) {
            this.hooks.forgetObject(this.box);
            this.hooks.forgetObject(this.box._indicator);
        } else {
            this.unfreeze();
        }
        for (const entry of this.actors.values()) {
            if (entry.destroyId) entry.thumbnail.disconnect(entry.destroyId);
        }
        this.actors.clear();
        this.hooks.clear();
        this.pin = null;
        this.box = null;
        this.adapter = null;
        this.allocation = null;
        this.indicatorAllocation = null;
    }
}
