// GNOME 51's real dynamic workspace checker, thumbnail allocator and thumbnail
// state machine, with model actors. Covers the two observed inactive-strip
// movement triggers without suppressing global dynamic workspace management.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const wmSource = fs.readFileSync(process.env.ORCHARD_WM_SOURCE, 'utf8');
const thumbnailSource = fs.readFileSync(process.env.ORCHARD_THUMBNAIL_SOURCE, 'utf8');
class Signals {
    constructor() { this.signals = new Map(); this.nextId = 1; }
    connect(name, callback) { const id = this.nextId++; this.signals.set(id, {name, callback}); return id; }
    disconnect(id) { assert(this.signals.delete(id)); }
    emit(name) { for (const entry of [...this.signals.values()]) if (entry.name === name) entry.callback(); }
}
class ActorBox {
    constructor(p = {}) { Object.assign(this, {x1: 0, y1: 0, x2: 0, y2: 0}, p); }
    copy() { return new ActorBox(this); }
    get_width() { return this.x2 - this.x1; }
    get_height() { return this.y2 - this.y1; }
}
class Actor extends Signals {
    constructor() { super(); this.visible = true; this.scale_x = 1; this.scale_y = 1; this.opacity = 255; this.transitions = new Map(); }
    allocate(box) { this.allocation = box.copy(); }
    set_allocation(box) { this.allocation = box.copy(); }
    has_allocation() { return !!this.allocation; }
    get_allocation_box() { return this.allocation; }
    ease_property(property, value, options) {
        this.transitions.set(property, {value, options, playing: true,
            is_playing() { return this.playing; }, pause() { this.playing = false; }, start() { this.playing = true; }});
    }
    get_transition(property) { return this.transitions.get(property); }
    remove_transition(property) { this.transitions.delete(property); }
    finishTransitions() {
        for (const [property, pending] of [...this.transitions]) {
            if (!pending.playing) continue;
            this.transitions.delete(property); this[property.replaceAll('-', '_')] = pending.value;
            pending.options.onComplete?.();
        }
    }
    queue_relayout() {}
    destroy() { this.destroyed = true; this.emit('destroy'); this.signals.clear(); }
}
function scenario(selected, target, monitorWidth = 1920) {
    let active, switcher, geometry;
    const workspaces = [], windows = [];
    const state = {NORMAL: 4, NEW: 0, EXPANDING: 1, EXPANDED: 2, ANIMATING_IN: 3,
        REMOVING: 5, ANIMATING_OUT: 6, ANIMATED_OUT: 7, COLLAPSING: 8, DESTROYED: 9};
    const manager = {
        get_n_workspaces: () => workspaces.length,
        get n_workspaces() { return workspaces.length; },
        get_workspace_by_index: i => workspaces[i],
        get_active_workspace_index: () => workspaces.indexOf(active),
        append_new_workspace() {
            geometry?.freeze();
            const position = workspaces.length; workspaces.push(makeWorkspace());
            if (geometry) { box.addThumbnails(position, 1); refresh(); }
        },
        remove_workspace(ws) {
            geometry?.freeze();
            const thumbnail = box._thumbnails.find(t => t.metaWorkspace === ws);
            const validIndex = box._thumbnails.filter(t => t.state <= state.NORMAL).indexOf(thumbnail);
            workspaces.splice(workspaces.indexOf(ws), 1);
            box.removeThumbnails(validIndex, 1); refresh();
        },
    };
    function makeWorkspace() {
        const ws = {index() { assert(workspaces.includes(ws), 'removed workspace index is never queried'); return workspaces.indexOf(ws); },
            activate() { assert(workspaces.includes(ws), 'removed workspace is never activated'); active = ws; switcher?.onGlobalWorkspaceChanged(); }};
        Object.defineProperty(ws, 'active', {get: () => active === ws});
        return ws;
    }
    for (let i = 0; i < 4; i++) workspaces.push(makeWorkspace());
    active = workspaces[0];
    function makeWindow(monitor, position) {
        const win = {monitor, workspace: workspaces[position],
            get_monitor() { return this.monitor; }, get_workspace() { return this.workspace; },
            get_window_type: () => 1, is_on_all_workspaces: () => false,
            change_workspace_by_index(index) { this.workspace = workspaces[index]; },
            get_compositor_private() { return {get_meta_window: () => win}; }};
        return win;
    }
    windows.push(makeWindow(0, 0), makeWindow(0, 1), makeWindow(0, 2), makeWindow(1, 0));
    const Main = {overview: {hide() {}}, xdndHandler: {},
        moveWindowToMonitorAndWorkspace(win, monitor, position) { win.monitor = monitor; win.workspace = workspaces[position]; }};
    const theme = {get_length: () => 12, adjust_preferred_width: (min, nat) => [min, nat],
        adjust_for_width: w => w, adjust_preferred_height: (min, nat) => [min, nat],
        get_content_box: b => new ActorBox({x2: b.get_width(), y2: b.get_height()}),
        get_vertical_padding: () => 0, get_border_width: () => 0, get_padding: () => 0};
    const ctx = vm.createContext({Extension: class {}, Main, ThumbnailState: state,
        Meta: {prefs_get_dynamic_workspaces: () => true, WindowType: {NORMAL: 1}},
        Shell: {WindowTracker: {get_default: () => ({get_startup_sequences: () => []})}},
        GLib: {SOURCE_REMOVE: 0, SOURCE_CONTINUE: 1}, MIN_NUM_WORKSPACES: 2,
        RESCALE_ANIMATION_TIME: 200, SLIDE_ANIMATION_TIME: 200,
        St: {Side: {TOP: 0, BOTTOM: 1, LEFT: 2, RIGHT: 3}},
        DND: {DragMotionResult: {CONTINUE: 0, MOVE_DROP: 1}},
        Clutter: {ActorBox, TextDirection: {RTL: 1}, get_default_text_direction: () => 0, AnimationMode: {EASE_OUT_QUAD: 0}},
        global: {workspace_manager: manager, workspaceManager: manager, get_current_time: () => 1,
            get_window_actors: () => windows.map(w => ({get_meta_window: () => w}))},
    });
    vm.runInContext(require('./runtime-source.cjs')() + '\nthis.Order = MonitorWorkspaceOrder; this.Switcher = WorkspaceSwitcher; this.Geometry = OverviewThumbnailGeometry;', ctx);
    function method(source, signature) {
        const start = source.indexOf(`    ${signature} {`), end = source.indexOf('\n    }\n', start);
        assert(start >= 0 && end > start, signature);
        return vm.runInContext(`({${source.slice(start, end + 6)}})`, ctx)[signature.split('(')[0]];
    }
    class Thumbnail extends Actor {
        constructor(metaWorkspace, monitorIndex) {
            super(); Object.assign(this, {metaWorkspace, monitorIndex, collapse_fraction: 0,
                slide_position: 0, _viewport: {scale_x: 1, scale_y: 1}});
        }
        setPorthole() {}
        setScale(x, y) { this._viewport.scale_x = x; this._viewport.scale_y = y; }
        workspaceRemoved() { this.removed = true; }
        _isMyWindow(actor) { const w = actor.get_meta_window(); return w.monitor === this.monitorIndex && w.workspace === this.metaWorkspace; }
    }
    for (const signature of ['activate(time)', 'handleDragOverInternal(source, actor, time)', 'acceptDropInternal(source, actor, time)'])
        Thumbnail.prototype[signature.split('(')[0]] = method(thumbnailSource, signature);
    ctx.WorkspaceThumbnail = Thumbnail;
    const orders = [new ctx.Order(workspaces), new ctx.Order(workspaces)];
    const inactive = 1 - selected;
    const record = {pinned: true, view: {_overviewAdjustment: {getStateTransitionParams: () => ({transitioning: false})}}};
    const box = Object.assign(new Actor(), {_thumbnails: [], _monitorIndex: inactive, _porthole: {width: 1920, height: 1080},
        _maxThumbnailScale: 0.1, _expandFraction: 1, _targetScale: 0, _scale: 0,
        _pendingScaleUpdate: false, _shouldShow: true, _spliceIndex: -1, _stateCounts: Object.fromEntries(Object.values(state).map(s => [s, 0])),
        _dropPlaceholderPos: -1, _scrollAdjustment: {value: 0}, _animatingIndicator: false,
        get_theme_node: () => theme, add_child() {}, set_child_above_sibling() {},
        _queueUpdateStates() { this.statesQueued = true; }, _clearDropPlaceholderLater() {},
        _dropPlaceholder: {allocate_preferred_size() {}, get_position: () => [0, 0], visible: false},
    });
    box._indicator = Object.assign(new Actor(), {get_theme_node: () => theme});
    Object.defineProperty(box, 'maxThumbnailScale', {get: () => box._maxThumbnailScale});
    Object.defineProperty(box, 'scale', {get: () => box._scale, set: value => { box._scale = value; }});
    for (const signature of ['addThumbnails(start, count)', 'removeThumbnails(start, count)', '_updateStates()',
        '_setThumbnailState(thumbnail, state)', '_iterateStateThumbnails(state, callback)', 'vfunc_allocate(box)',
        'vfunc_get_preferred_width(_forHeight)', 'vfunc_get_preferred_height(forWidth)'])
        box[signature.split('(')[0]] = method(thumbnailSource, signature);
    box.get_preferred_width = box.vfunc_get_preferred_width;
    box.get_preferred_height = box.vfunc_get_preferred_height;
    box.addThumbnails(0, workspaces.length);
    const adapter = {box, record, order: orders[inactive], isolation: {_workspaces: () => workspaces}};
    geometry = new ctx.Geometry(adapter); geometry.start();
    function refresh() {
        orders.forEach(order => order.reconcile(workspaces));
        const valid = box._thumbnails.filter(t => t.state <= state.NORMAL)
            .sort((a, b) => orders[inactive].workspaces.indexOf(a.metaWorkspace) - orders[inactive].workspaces.indexOf(b.metaWorkspace));
        let i = 0;
        box._thumbnails = box._thumbnails.map(t => t.state <= state.NORMAL ? valid[i++] : t);
        geometry.refresh();
    }
    const overview = {selectedMonitor: selected,
        moveWithoutPreviewAnimation(_window, _target, move) { move(); },
        shiftWorkspaceOrder(monitor, shift) {
            if (monitor !== inactive) geometry.shift(shift, workspaces);
            orders.forEach((order, i) => { if (i !== monitor) order.shift(shift, workspaces); });
        },
        syncActiveWorkspace: refresh,
    };
    switcher = new ctx.Switcher({automaticSwitchingIsEnabled: () => true}, {resolve: () => selected}, {selectedMonitor: null}, overview);
    const tracker = {_pauseWorkspaceCheck: false, _checkWorkspaces: method(wmSource, '_checkWorkspaces()')};
    Object.defineProperty(tracker, '_workspaces', {get: () => workspaces});
    function layout() {
        const [, naturalWidth] = box.get_preferred_width(-1);
        const width = Math.min(monitorWidth, naturalWidth);
        const [, height] = box.get_preferred_height(width);
        const left = (monitorWidth - width) / 2;
        box.vfunc_allocate(new ActorBox({x1: left, x2: left + width, y2: height}));
    }
    function bounds(thumbnail) {
        return {x: box.allocation.x1 + thumbnail.allocation.x1,
            y: box.allocation.y1 + thumbnail.allocation.y1,
            width: thumbnail.allocation.get_width(), height: thumbnail.allocation.get_height(),
            scaleX: thumbnail._viewport.scale_x, scaleY: thumbnail._viewport.scale_y};
    }
    function drainStates() {
        for (let i = 0; i < 8; i++) {
            box._updateStates();
            for (const thumbnail of [...box._thumbnails]) thumbnail.finishTransitions();
            box.finishTransitions();
        }
    }
    layout();
    const before = orders[inactive].workspaces.map(ws => bounds(box._thumbnails.find(t => t.metaWorkspace === ws)));
    const beforeIndicator = box._indicator.allocation.copy();
    workspaces[target].activate();
    tracker._checkWorkspaces(); refresh(); drainStates(); layout();
    assert.equal(workspaces.length, 5, 'Shell still appends a real dynamic workspace');
    assert.equal(orders[inactive].workspaces.indexOf(active), 0);
    for (let i = 0; i < 4; i++) {
        const thumbnail = box._thumbnails.find(t => t.metaWorkspace === orders[inactive].workspaces[i]);
        assert.deepEqual(bounds(thumbnail), before[i], 'inactive logical slot allocation and scale stay stationary');
    }
    assert.deepEqual(box._indicator.allocation, beforeIndicator, 'inactive indicator geometry stays stationary');
    const newThumbnail = box._thumbnails.find(t => t.metaWorkspace === workspaces[4]);
    assert.equal(newThumbnail.visible, false, 'new global slot stays hidden on inactive display');
    // A subsequent compensation can move an established slot onto the newly
    // appended physical actor: it must become visible in the old slot without
    // a native entrance animation or a change in geometry.
    const newlyMapped = newThumbnail.metaWorkspace;
    newlyMapped.activate();
    tracker._checkWorkspaces(); refresh(); drainStates(); layout();
    assert.equal(newThumbnail.visible, true);
    assert.equal(newThumbnail.state, state.NORMAL);
    assert.deepEqual(bounds(newThumbnail), before[0]);
    // Dynamic prune before the active slot: retain an inert empty placeholder
    // and the geometry of all surviving slots, rather than shifting them left.
    const removed = orders[inactive].workspaces[1];
    for (const win of windows) if (win.workspace === removed) win.workspace = active;
    const removedThumbnail = box._thumbnails.find(t => t.metaWorkspace === removed);
    tracker._checkWorkspaces(); refresh(); drainStates(); layout();
    assert(!workspaces.includes(removed));
    assert.equal(removedThumbnail.state, state.REMOVING);
    assert.equal(removedThumbnail.destroyed, undefined, 'empty placeholder is retained while inactive');
    assert.deepEqual(bounds(removedThumbnail), before[1]);
    assert.equal(removedThumbnail.handleDragOverInternal(Main.xdndHandler, {}, 1), 0,
        'XDND never activates a retained removed workspace');
    const targetThumb = box._thumbnails.find(t => t.metaWorkspace === active);
    assert.deepEqual(bounds(targetThumb), before[0]);
    // Selecting the display restores native membership/geometry before its
    // click/drop handlers are used, including normal native collapse cleanup.
    record.pinned = false; geometry.unfreeze(); drainStates(); layout();
    assert.equal(removedThumbnail.destroyed, true);
    assert(box._thumbnails.every(t => t.visible && workspaces.includes(t.metaWorkspace)));
    const clicked = box._thumbnails.find(t => t.metaWorkspace !== active);
    overview.selectedMonitor = inactive; clicked.activate(1); assert.equal(active, clicked.metaWorkspace);
    const dragged = makeWindow(selected, 0);
    assert.equal(clicked.acceptDropInternal({metaWindow: dragged}, {}, 1), true);
    assert.equal(dragged.monitor, inactive); assert.equal(dragged.workspace, clicked.metaWorkspace);
    // Disable while pinned restores native allocation methods and lets queued
    // collapse/add state transitions finish. Re-enable creates no extra hooks.
    layout(); record.pinned = true;
    let completed = 0;
    const pausedActor = box._thumbnails[0];
    pausedActor.ease_property('collapse-fraction', 0, {onComplete: () => completed++});
    geometry.freeze();
    assert.equal(pausedActor.get_transition('collapse-fraction').is_playing(), false);
    pausedActor.finishTransitions(); assert.equal(completed, 0);
    const nativeAllocate = Actor.prototype.allocate;
    geometry.stop();
    pausedActor.finishTransitions(); assert.equal(completed, 1, 'disable resumes the owned pause exactly once');
    assert.equal(box.set_allocation, Actor.prototype.set_allocation);
    assert.equal(box._indicator.allocate, nativeAllocate);
    assert(box._thumbnails.every(t => t.allocate === nativeAllocate && t.signals.size === 0));
    assert.equal(geometry.box, null); assert.equal(geometry.adapter, null);
    drainStates(); layout();
    geometry = new ctx.Geometry(adapter); geometry.start(); layout();
    const destroyedDuringPin = box._thumbnails[0];
    destroyedDuringPin.ease_property('collapse-fraction', 0, {onComplete() {}});
    geometry.freeze();
    assert(geometry.pin.pausedTransitions.some(({actor}) => actor === destroyedDuringPin));
    box._thumbnails.splice(box._thumbnails.indexOf(destroyedDuringPin), 1);
    destroyedDuringPin.destroy();
    assert(!geometry.actors.has(destroyedDuringPin));
    assert(!geometry.pin.pausedTransitions.some(({actor}) => actor === destroyedDuringPin),
        'destroyed thumbnails release paused-transition references immediately');
    geometry.stop();
    assert(box._thumbnails.every(t => t.signals.size === 0));
}
scenario(0, 3);
scenario(1, 1);
scenario(0, 3, 600);
scenario(1, 1, 600);
console.log('PASS: native dynamic append/prune keeps inactive thumbnail slots, indicator, size and scale stationary for primary-last-slot and secondary-first-swipe scenarios; selection, clicks, drops, XDND guards and cleanup');
