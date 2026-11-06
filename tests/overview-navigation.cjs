// Run GNOME 51's real allocation, membership, keyboard and wheel methods against
// model actors. This catches index and pre-bound-signal mistakes; it does not
// substitute for a running Mutter/GJS visual acceptance test.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
function source(env, resource) {
    return process.env[env] ? fs.readFileSync(process.env[env], 'utf8') :
        execFileSync('/usr/bin/gresource', ['extract', '/usr/lib/gnome-shell/libshell-51.so',
            `/org/gnome/shell/ui/${resource}.js`], {encoding: 'utf8'});
}
const native = source('ORCHARD_OVERVIEW_SOURCE', 'workspacesView');
const wmNative = source('ORCHARD_WM_SOURCE', 'windowManager');
const trackerNative = source('ORCHARD_SWIPE_SOURCE', 'swipeTracker');
const thumbnailNative = source('ORCHARD_THUMBNAIL_SOURCE', 'workspaceThumbnail');
class Signals {
    constructor() { this.signals = new Map(); this.next = 1; }
    connect(name, cb) { const id = this.next++; this.signals.set(id, {name, cb}); return id; }
    disconnect(id) { assert(this.signals.delete(id), 'disconnect live handler'); }
    connectObject(...args) {
        const owner = args.pop();
        for (let i = 0; i < args.length; i += 2) {
            const id = this.connect(args[i], args[i + 1]); this.signals.get(id).owner = owner;
        }
    }
    disconnectObject(owner) {
        for (const [id, entry] of this.signals) if (entry.owner === owner) this.signals.delete(id);
    }
    emit(name, ...args) {
        for (const [id, entry] of [...this.signals])
            if (this.signals.has(id) && entry.name === name) entry.cb(this, ...args);
    }
    owned(owner) { return [...this.signals.values()].filter(s => s.owner === owner).length; }
}
class Adjustment extends Signals {
    constructor(props = {}) { super(); this._value = 0; Object.assign(this, {lower: 0, upper: 4,
        page_size: 1, step_increment: 1, page_increment: 1}, props); }
    get value() { return this._value; }
    set value(value) { this._value = value; this.emit('notify::value'); }
    get_transition() { return this.pending ?? null; }
    remove_transition() { this.pending = null; }
    ease(value, options) { this.pending = {value, options}; }
    complete() {
        const pending = this.pending; assert(pending, 'animation pending');
        this.value = pending.value; this.pending = null; pending.options.onComplete?.();
    }
}
class ActorBox {
    constructor(props = {}) { Object.assign(this, {x1: 0, y1: 0, x2: 1000, y2: 600}, props); }
    get_size() { return [this.x2 - this.x1, this.y2 - this.y1]; }
    get_origin() { return [this.x1, this.y1]; }
    set_origin(x, y) { const [w, h] = this.get_size(); this.x1 = x; this.y1 = y; this.set_size(w, h); }
    set_size(w, h) { this.x2 = this.x1 + w; this.y2 = this.y1 + h; }
    copy() { return new ActorBox(this); }
    interpolate(other, progress) { return progress < 0.5 ? this.copy() : other.copy(); }
}
let workspaces = [], active, selected = 0, enabled = true, activations = 0, destroyedActors = 0;
const motion = {LEFT: 0, RIGHT: 1, UP: 2, DOWN: 3};
const Clutter = {EVENT_PROPAGATE: 0, EVENT_STOP: 1, TextDirection: {LTR: 0, RTL: 1},
    AnimationMode: {EASE_OUT_CUBIC: 0}, ScrollDirection: {UP: 0, DOWN: 1, LEFT: 2, RIGHT: 3, SMOOTH: 4},
    EventType: {SCROLL: 1}, ActorBox, get_default_text_direction: () => rtl ? 1 : 0};
let rtl = false;
const manager = Object.assign(new Signals(), {
    get_n_workspaces: () => workspaces.length, get_workspace_by_index: i => workspaces[i],
    get_active_workspace_index: () => workspaces.indexOf(active), get_active_workspace: () => active,
    layout_rows: 1,
});
for (const prop of ['n_workspaces', 'nWorkspaces']) Object.defineProperty(manager, prop, {get: () => workspaces.length});
const wm = new Signals();
function makeWorkspace() {
    const ws = {index: () => {
        assert(workspaces.includes(ws), 'Meta.Workspace.index() must not be called after removal');
        return workspaces.indexOf(ws);
    }, get_neighbor(direction) {
        let step = direction === motion.UP || direction === motion.LEFT ? -1 : 1;
        if (manager.layout_rows !== -1 && rtl) step *= -1;
        return workspaces[ws.index() + step] ?? ws;
    }, activate() {
        if (active === ws) return;
        const from = active.index(); active = ws; activations++;
        manager.emit('active-workspace-changed'); wm.emit('switch-workspace', from, ws.index(), 0);
    }};
    Object.defineProperty(ws, 'active', {get: () => active === ws}); return ws;
}
workspaces = Array.from({length: 4}, makeWorkspace); active = workspaces[0];
const windows = workspaces.map(workspace => ({workspace, get_monitor: () => 1,
    get_workspace() { return this.workspace; }, get_window_type: () => 1,
    is_on_all_workspaces: () => false, change_workspace_by_index(index) { this.workspace = workspaces[index]; }}));
const stage = new Signals();
const overview = Object.assign(new Signals(), {visible: true, closing: false});
const Main = {actionMode: 2, overview, layoutManager: {primaryIndex: 0, overviewGroup: new Signals()}, wm: {_canScroll: true,
    actionMoveWorkspace(ws) { ws.activate(); }, insertWorkspace() {}}};
class WorkspaceActor {
    constructor(metaWorkspace) { Object.assign(this, {metaWorkspace, stateAdjustment: {value: 0}, visible: true}); }
    set_scale(x, y) { this.scale = x; }
    show() { this.visible = true; }
    destroy() { this.destroyed = true; destroyedActors++; }
    allocate_align_fill(box) { this.box = box.copy(); }
    get_preferred_width() { return [0, 800]; }
    get_preferred_height() { return [0, 450]; }
}
class InjectionManager {
    constructor() { this.saved = []; }
    overrideMethod(proto, name, factory) { this.saved.push([proto, name, proto[name]]); proto[name] = factory(proto[name]); }
    clear() { for (const [proto, name, original] of this.saved.reverse()) proto[name] = original; this.saved = []; }
}
const context = vm.createContext({InjectionManager, State: {SCROLLING: 1}, Main, Clutter, St: {Adjustment}, Meta: {MotionDirection: motion, WindowType: {NORMAL: 1}},
    Shell: {ActionMode: {OVERVIEW: 2}}, Extension: class {}, Workspace: {Workspace: WorkspaceActor},
    global: {workspace_manager: manager, workspaceManager: manager, stage, window_manager: wm,
        get_current_time: () => 1, get_window_actors: () => windows.map(w => ({meta_window: w, get_meta_window: () => w}))},
    FitMode: {SINGLE: 0, ALL: 1}, WORKSPACE_INACTIVE_SCALE: 0.94,
    Util: {lerp: (a, b, p) => a + (b - a) * p}, WORKSPACE_SWITCH_TIME: 250,
    OverviewControls: {ControlsState: {HIDDEN: 0, WINDOW_PICKER: 1, APP_GRID: 2}},
    GLib: {PRIORITY_DEFAULT: 0, timeout_add_once(_priority, _time, callback) { callback(); }}, SCROLL_TIMEOUT_TIME: 150,
    VELOCITY_THRESHOLD_TOUCHPAD: 0.6, VELOCITY_THRESHOLD_TOUCH: 0.3,
    MIN_ANIMATION_DURATION: 100, MAX_ANIMATION_DURATION: 400, ANIMATION_BASE_VELOCITY: 0.002, DURATION_MULTIPLIER: 3,
    ThumbnailState: {NORMAL: 4}, logError(error) { throw error; },
});
vm.runInContext('Math.clamp = (v, min, max) => Math.min(max, Math.max(min, v));', context);
function method(text, signature, after = 0) {
    const start = text.indexOf(`    ${signature} {`, after);
    const end = text.indexOf('\n    }\n', start);
    assert(start >= 0 && end > start, `GNOME method ${signature}`);
    return vm.runInContext(`({${text.slice(start, end + 6)}})`, context)[signature.split('(')[0]];
}
let failTracker = false;
class Tracker extends Signals {
    constructor(actor) {
        super(); this.enabled = true; this.orientation = 1; this._allowedModes = 2; this.allowLongSwipes = true; this.scrollModifiers = 0;
        if (actor) {
            this._touchpadGesture = {};
            actor.connectObject('event::touchpad', () => {}, this._touchpadGesture);
            actor.connect('scroll-event', () => {});
            if (failTracker) throw new Error('simulated tracker construction failure');
        }
    }
    confirmSwipe(...args) { this.confirmation = args; nativeConfirm.apply(this, args); }
    destroy() { this.destroyed = true; this.signals.clear(); }
    canHandleScrollEvent() { return false; }
    _reset() { this._state = 0; this._cancelled = false; }
}
const nativeConfirm = method(trackerNative, 'confirmSwipe(distance, snapPoints, currentProgress, cancelProgress)');
for (const signature of ['_getBounds(pos)', '_updateGesture(delta, distance)', '_findClosestPoint(pos)',
    '_getEndProgress(velocity, distance, isTouchpad)', '_endGesture(velocity, distance, isTouchpad)', '_cancelPanGesture()'])
    Tracker.prototype[signature.split('(')[0]] = method(trackerNative, signature);
context.SwipeTracker = {SwipeTracker: Tracker};
vm.runInContext(require('./runtime-source.cjs')() + '\nthis.Isolation = OverviewWorkspaceIsolation; this.Switcher = WorkspaceSwitcher; this.LogicalOrder = LogicalWorkspaceOrder;', context);
const shared = new Adjustment();
function makeView() {
    const view = Object.assign(new Signals(), {_scrollAdjustment: shared, _workspaces: workspaces.map(ws => new WorkspaceActor(ws)),
        _fitModeAdjustment: {value: 0}, _overviewAdjustment: {getStateTransitionParams: () => ({initialState: 1, finalState: 1, progress: 0})},
        _animating: false, _gestureActive: false, text_direction: 0, _monitorIndex: 0,
        has_allocation: () => true, queue_relayout() {}, add_child() {}, set_child_at_index() {}, set_child_above_sibling() {},
        set_allocation() {}, _getSpacing: () => 24, _getInitialBoxes: box => [box.copy(), box.copy()],
    });
    for (const signature of ['_updateWorkspaces()', '_updateWorkspacesState()', '_updateVisibility()', '_raiseActiveWorkspace()',
        'getActiveWorkspace()', '_scrollToActive()', '_onScrollAdjustmentChanged()', 'startTouchGesture()', 'endTouchGesture()',
        '_activeWorkspaceChanged(_wm, _from, _to, _direction)', '_getWorkspaceModeForOverviewState(state)',
        '_getFirstFitSingleWorkspaceBox(box, spacing, vertical)', '_getFirstFitAllWorkspaceBox(box, spacing, vertical)'])
        view[signature.split('(')[0]] = method(native, signature);
    view.allocate = method(native, 'vfunc_allocate(box)', native.indexOf('export const WorkspacesView'));
    shared.connectObject('notify::value', view._onScrollAdjustmentChanged.bind(view), view);
    manager.connectObject('notify::n-workspaces', view._updateWorkspaces.bind(view),
        'workspaces-reordered', () => view._workspaces.sort((a, b) => a.metaWorkspace.index() - b.metaWorkspace.index()), view);
    wm.connectObject('switch-workspace', view._activeWorkspaceChanged.bind(view), view);
    return view;
}
function makeBox() {
    const actorProperties = () => ({visible: true, _viewport: {scale_x: 1, scale_y: 1},
        has_allocation: () => false, get_transition: () => null,
        allocate() {}, set_allocation() {}, setScale() {}, handleDragOverInternal() {}});
    const makeThumbnail = metaWorkspace => Object.assign(new Signals(), actorProperties(), {metaWorkspace, state: 4});
    const box = Object.assign(new Signals(), {_scrollAdjustment: shared,
        ...actorProperties(), _indicator: actorProperties(),
        _thumbnails: workspaces.map(makeThumbnail),
        _updateIndicator: method(thumbnailNative, '_updateIndicator()'),
        _updateStates() {}, _activateThumbnailAtPoint() {}, handleDragOver() {},
        _queueUpdateStates() {}, queue_relayout() {}, addThumbnails() {}, removeThumbnails() {}, acceptDrop() {},
    });
    // The full native lifecycle/drop implementation has its own regression
    // suite; here retain workspace identities while testing coupled rendering.
    manager.connect('notify::n-workspaces', () => {
        box._thumbnails = box._thumbnails.filter(t => workspaces.includes(t.metaWorkspace));
        for (const metaWorkspace of workspaces)
            if (!box._thumbnails.some(t => t.metaWorkspace === metaWorkspace)) box._thumbnails.push(makeThumbnail(metaWorkspace));
    });
    shared.connectObject('notify::value', () => box._updateIndicator(), box);
    return box;
}
const primary = makeView(), secondary = makeView(); secondary._monitorIndex = 1;
const primaryBox = makeBox(), secondaryBox = makeBox();
const host = Object.assign(new Signals(), {_workspacesView: secondary, _thumbnails: secondaryBox,
    startTouchGesture() { secondary.startTouchGesture(); }, endTouchGesture() { secondary.endTouchGesture(); }});
const originalTracker = new Tracker();
const display = {_workspacesViews: [primary, host], _scrollAdjustment: shared, _swipeTracker: originalTracker,
    width: 1000, height: 600, mapped: true, reactive: true, _workspacesOnlyOnPrimary: false, _primaryIndex: 0,
    _overviewAdjustment: {value: 1}, _gestureActive: false, get_text_direction: () => rtl ? 1 : 0,
    _getMonitorIndexForEvent: () => selected, _updateSwipeTracker() { this._swipeTracker.enabled = this.mapped; },
    _updateTrackerOrientation() { this._swipeTracker.orientation = manager.layout_rows === -1 ? 1 : 0; },
};
const displayStart = native.indexOf('export class WorkspacesDisplay');
for (const signature of ['_endTouchGesture()', '_moveToWorkspace(which)', '_nextWorkspace()', '_prevWorkspace()',
    '_onScrollEvent(actor, event)', '_activeWorkspaceChanged(_wm, _from, to, _direction)',
    '_switchWorkspaceBegin(tracker, monitor)', '_switchWorkspaceUpdate(tracker, progress)', '_switchWorkspaceEnd(tracker, duration, endProgress)'])
    display[signature.split('(')[0]] = method(native, signature, displayStart);
wm.connectObject('switch-workspace', display._activeWorkspaceChanged.bind(display), display);
// These are bound before extension enable, just as in GNOME. They must remain
// intact but cannot process the owned logical tracker.
for (const [signal, name] of [['begin', '_switchWorkspaceBegin'], ['update', '_switchWorkspaceUpdate'], ['end', '_switchWorkspaceEnd']])
    originalTracker.connect(signal, display[name].bind(display));
Main.wm.handleWorkspaceScroll = method(wmNative, 'handleWorkspaceScroll(event)');
overview._overview = {controls: {_workspacesDisplay: display, _thumbnailsBox: primaryBox}};
const config = {conditionallyEnableAutomaticSwitching() {}, automaticSwitchingIsEnabled: () => enabled};
const isolation = new context.Isolation(config, {resolve: () => selected});
const switcher = new context.Switcher(config, {resolve: () => selected}, {selectedMonitor: null}, isolation);
manager.connect('active-workspace-changed', () => switcher.onGlobalWorkspaceChanged());
const nativePrimaryScroll = primary._scrollToActive;
isolation.enable();
assert(isolation._session.navigation);
assert.equal(originalTracker.enabled, false);
assert.notEqual(display._swipeTracker, originalTracker);
assert.notEqual(primary._scrollAdjustment, shared);
assert.notEqual(secondary._scrollAdjustment, shared);
const slots = () => isolation._session.records[1].order.workspaces.map(ws => windows.find(w => w.workspace === ws));
const originalContents = slots();
// A switch on monitor 0 rotates the inactive monitor's physical mapping.
workspaces[1].activate();
assert.deepEqual(slots(), originalContents);
const secondaryOrder = () => secondary._workspaces.map(ws => ws.metaWorkspace.index());
assert.deepEqual(secondaryOrder(), [1, 2, 3, 0]);
assert.equal(secondary._scrollAdjustment.value, 0);
assert.equal(secondaryBox._scrollAdjustment.value, 0);
selected = 1; stage.emit('motion-event');
const tracker = display._swipeTracker;
function swipe(from, to) {
    const order = isolation._session.records[selected].order.workspaces;
    order[from].activate();
    if (primary._scrollAdjustment.pending) primary._scrollAdjustment.complete();
    if (secondary._scrollAdjustment.pending) secondary._scrollAdjustment.complete();
    // Clicks/global activation synchronize logical values before this gesture.
    tracker.emit('begin', selected);
    assert.equal(tracker.confirmation[2], from);
    assert.deepEqual(Array.from(tracker.confirmation[1]), [0, 1, 2, 3]);
    const stationary = primary._scrollAdjustment.value;
    tracker._updateGesture((to - from) * 500, 1000);
    assert.equal(secondary._scrollAdjustment.value, (from + to) / 2);
    assert.equal(secondaryBox._scrollAdjustment.value, (from + to) / 2, 'outline follows logical seam progress');
    assert.deepEqual(secondaryBox._thumbnails.map(t => t.metaWorkspace), secondary._workspaces.map(ws => ws.metaWorkspace),
        'thumbnail strip and native large-view allocation share the same order');
    assert.equal(primary._scrollAdjustment.value, stationary, 'inactive monitor stays still in drag');
    secondary.allocate(new ActorBox());
    const ordered = secondary._workspaces;
    for (let i = 1; i < ordered.length; i++) assert(ordered[i].box.x1 > ordered[i - 1].box.x1,
        'native allocator lays out the logical sequence monotonically');
    const target = order[to];
    tracker._updateGesture((to - from) * 300, 1000);
    tracker._endGesture(0, 1000, true);
    secondary._scrollAdjustment.complete();
    assert.equal(active, target);
    assert.equal(shared.value, target.index(), 'Shell shared adjustment remains a physical workspace index');
    assert.equal(secondary._scrollAdjustment.value, to);
}
swipe(2, 3); // physical 3 -> 0, logical +1
swipe(3, 2); // physical 0 -> 3, logical -1
// Native Page and wheel routes must follow the same seam in both directions.
const secondaryRecord = isolation._session.records[1];
secondaryRecord.order.workspaces[2].activate();
display._nextWorkspace(); assert.equal(active, secondaryRecord.order.workspaces[3]);
display._prevWorkspace(); assert.equal(active, secondaryRecord.order.workspaces[2]);
const event = direction => ({type: () => Clutter.EventType.SCROLL, get_scroll_direction: () => direction});
display._onScrollEvent(overview, event(Clutter.ScrollDirection.DOWN));
assert.equal(active, secondaryRecord.order.workspaces[3]);
display._onScrollEvent(overview, event(Clutter.ScrollDirection.UP));
assert.equal(active, secondaryRecord.order.workspaces[2]);
assert.equal(Object.hasOwn(active, 'get_neighbor'), true, 'native instance method retained');
// A discrete input or thumbnail activation interrupts pending logical settle.
tracker.emit('begin', 1); tracker.emit('end', 200, 3);
const interruptedCompletion = secondary._scrollAdjustment.pending.options.onComplete;
display._nextWorkspace();
const discreteTarget = active; interruptedCompletion(); assert.equal(active, discreteTarget);
assert.equal(isolation._session.gesture, false);
tracker.emit('begin', 1); tracker.emit('end', 200, 2);
const clickInterrupted = secondary._scrollAdjustment.pending.options.onComplete;
secondaryRecord.order.workspaces[1].activate();
const clickTarget = active; clickInterrupted(); assert.equal(active, clickTarget);
assert.equal(isolation._session.gesture, false);
// Bounds, RTL, vertical layouts and native interaction gates.
secondaryRecord.order.workspaces[3].activate();
const beforeBoundary = activations;
display._nextWorkspace(); assert.equal(activations, beforeBoundary, 'logical last slot does not wrap');
display._overviewAdjustment.value = 2;
display._prevWorkspace(); assert.equal(activations, beforeBoundary, 'Page navigation is disabled in app grid');
display._overviewAdjustment.value = 1;
Main.wm._canScroll = false;
display._onScrollEvent(overview, event(Clutter.ScrollDirection.UP)); assert.equal(activations, beforeBoundary);
Main.wm._canScroll = true;
display._onScrollEvent(overview, event(Clutter.ScrollDirection.SMOOTH)); assert.equal(activations, beforeBoundary);
rtl = true;
display._prevWorkspace(); assert.equal(active, secondaryRecord.order.workspaces[2]);
display._nextWorkspace(); assert.equal(active, secondaryRecord.order.workspaces[3]);
rtl = false; manager.layout_rows = -1;
display._prevWorkspace(); assert.equal(active, secondaryRecord.order.workspaces[2]);
display._onScrollEvent(overview, event(Clutter.ScrollDirection.DOWN)); assert.equal(active, secondaryRecord.order.workspaces[3]);
manager.layout_rows = 1;
// Cancellation uses the tracker-confirmed logical cancel point; no activation.
if (secondary._scrollAdjustment.pending) secondary._scrollAdjustment.complete();
tracker.emit('begin', 1);
const cancelActive = active, cancelProgress = tracker._cancelProgress;
tracker._updateGesture(-600, 1000); tracker._cancelPanGesture();
secondary._scrollAdjustment.complete(); assert.equal(active, cancelActive);
// Pointer crossing during gesture and settle must not retarget compensation.
tracker.emit('begin', 1); tracker.emit('update', 2.4);
selected = 0; stage.emit('motion-event'); assert.equal(isolation.selectedMonitor, 1);
tracker.emit('end', 100, 2); assert.equal(isolation.selectedMonitor, 1);
secondary._scrollAdjustment.complete(); assert.equal(isolation.selectedMonitor, 0);
// A dynamic append must preserve all actors: native's originally bound
// physical-index update would destroy actors in a cyclically ordered array.
const oldActors = [...secondary._workspaces], oldDestroyed = destroyedActors;
workspaces.push(makeWorkspace()); manager.emit('notify::n-workspaces');
assert.equal(destroyedActors, oldDestroyed);
assert(oldActors.every(ws => secondary._workspaces.includes(ws)));
assert.equal(secondary._workspaces.length, 5);
// Remove a workspace during settling; pending completion must not activate it.
selected = 1; stage.emit('motion-event'); tracker.emit('begin', 1);
const targetIndex = secondaryRecord.order.workspaces.findIndex(ws => ws !== active);
tracker.emit('end', 200, targetIndex);
const staleCompletion = secondary._scrollAdjustment.pending.options.onComplete;
const removed = secondaryRecord.order.workspaces[targetIndex];
const removedPosition = workspaces.indexOf(removed);
workspaces.splice(removedPosition, 1);
for (const window of windows) if (window.workspace === removed) window.workspace = workspaces[Math.min(removedPosition, workspaces.length - 1)];
manager.emit('notify::n-workspaces');
const beforeStale = activations; staleCompletion(); assert.equal(activations, beforeStale);
assert.equal(isolation._session.gesture, false);
assert(secondary._workspaces.every(ws => ws.metaWorkspace !== removed));
const logicalOrder = [...secondaryRecord.order.workspaces];
[workspaces[0], workspaces[1]] = [workspaces[1], workspaces[0]]; manager.emit('workspaces-reordered');
assert.deepEqual(Array.from(secondaryRecord.order.workspaces), logicalOrder, 'external physical reorder retains logical identities');
assert.deepEqual(secondary._workspaces.map(ws => ws.metaWorkspace), logicalOrder);
// Stop mid-gesture/mode change restores native tracker, actors and bound signal
// semantics; delayed callbacks and wrappers retained by other extensions inert.
tracker.emit('begin', 1); tracker.emit('update', 0.4); tracker.emit('end', 200, 0);
const afterStopCompletion = secondary._scrollAdjustment.pending.options.onComplete;
const retainedMove = display._moveToWorkspace;
const originalMoveWrapper = display._moveToWorkspace;
const navigation = isolation._session.navigation;
const navigationSession = isolation._session;
display._moveToWorkspace = function (...args) { return originalMoveWrapper.apply(this, args); };
enabled = false; isolation.refresh();
assert.equal(display._swipeTracker, originalTracker); assert.equal(originalTracker.enabled, true);
assert.equal(navigation.session, null); assert.equal(navigation.isolation, null);
assert.equal(navigationSession.navigation, null, 'session releases its stopped navigation helper');
assert.equal(tracker.signals.size, 0);
assert.equal(tracker.destroyed, true); assert.equal(primary._scrollAdjustment, shared);
assert.equal(secondary._scrollAdjustment, shared); assert.equal(primary._scrollToActive, nativePrimaryScroll);
assert.equal(manager.owned(primary), 2); assert.equal(manager.owned(secondary), 2);
assert.equal(shared.owned(primary), 1); assert.equal(shared.owned(secondary), 1);
assert.equal(stage.signals.size, 0);
assert.equal(Main.layoutManager.overviewGroup.signals.size, 0, 'owned tracker actor handlers are removed');
const afterStopActive = active; afterStopCompletion(); assert.equal(active, afterStopActive);
assert.deepEqual(secondaryOrder(), workspaces.map((_, i) => i));
const nativeNeighbor = active.get_neighbor(motion.RIGHT);
retainedMove.call(display, motion.RIGHT); assert.equal(active, nativeNeighbor);
// Re-enable and repeat teardown; no accumulating owned handlers.
enabled = true; isolation.refresh();
assert.equal(manager.owned(primary), 0); assert.equal(manager.owned(secondary), 0);
isolation.destroy(); assert.equal(manager.owned(primary), 2); assert.equal(manager.owned(secondary), 2);
// Partial construction must also restore native handlers and tracker state.
failTracker = true;
const expectedErrors = [];
context.logError = error => expectedErrors.push(error);
isolation.enable();
assert.equal(expectedErrors.length, 1);
assert.equal(isolation._session, null);
assert.equal(manager.owned(primary), 2); assert.equal(manager.owned(secondary), 2);
assert.equal(shared.owned(primary), 1); assert.equal(shared.owned(secondary), 1);
assert.equal(Main.layoutManager.overviewGroup.signals.size, 0);
assert.equal(display._swipeTracker, originalTracker); assert.equal(originalTracker.enabled, true);
isolation.destroy(); failTracker = false;
context.logError = error => { throw error; };
// Destruction while a gesture is settling also invalidates captured targets.
isolation.enable();
const destructionTracker = display._swipeTracker;
destructionTracker.emit('begin', 1); destructionTracker.emit('end', 100, 0);
const destroyedCompletion = secondary._scrollAdjustment.pending.options.onComplete;
secondary.emit('destroy');
assert.equal(isolation._session, null);
const destroyedActive = active; destroyedCompletion(); assert.equal(active, destroyedActive);
assert.equal(destructionTracker.destroyed, true);
assert.equal(manager.owned(secondary), 0, 'destroyed views do not regain native manager handlers');
assert.equal(display._swipeTracker, originalTracker);
isolation.destroy();
console.log('PASS: GNOME 51 logical large-view allocation, bidirectional seam swipes/Page/wheel, bounds, cancellation, selection lock, dynamic workspace lifecycle, mode and cleanup');

// Integrate native render/membership callbacks with independently sized stacks.
// Four (or more) physical workspaces must still render as one logical slot per
// clean monitor, and expanding one monitor must not expose pool entries on the
// other. The fake InjectionManager dispatches the real native vfunc bodies.
class ProjectionView extends Signals {}
ProjectionView.prototype.vfunc_allocate = method(native, 'vfunc_allocate(box)', native.indexOf('export const WorkspacesView'));
class ProjectionBox extends Signals {}
for (const signature of ['vfunc_allocate(box)', 'vfunc_get_preferred_width(_forHeight)', 'vfunc_get_preferred_height(forWidth)'])
    ProjectionBox.prototype[signature.split('(')[0]] = method(thumbnailNative, signature);
ActorBox.prototype.get_width = function () { return this.x2 - this.x1; };
ActorBox.prototype.get_height = function () { return this.y2 - this.y1; };
context.St.Side = {TOP: 0, BOTTOM: 1, LEFT: 2, RIGHT: 3};
const theme = {get_content_box: b => new ActorBox({x2: b.get_width(), y2: b.get_height()}), get_length: () => 12,
    get_vertical_padding: () => 0, get_border_width: () => 0, get_padding: () => 0, adjust_for_width: w => w,
    adjust_preferred_width: (min, nat) => [min, nat], adjust_preferred_height: (min, nat) => [min, nat]};
function projectionThumbnail(metaWorkspace, monitorIndex) {
    return Object.assign(new Signals(), {metaWorkspace, monitorIndex, state: 4, visible: true, collapse_fraction: 0,
        scale_x: 1, scale_y: 1, opacity: 255, _viewport: {scale_x: 1, scale_y: 1},
        has_allocation() { return !!this.allocation; }, get_allocation_box() { return this.allocation; }, get_transition() { return null; },
        setScale(x, y) { this._viewport.scale_x = x; this._viewport.scale_y = y; },
        allocate(box) { this.allocation = box.copy(); this.x = box.x1; this.width = box.get_width(); },
        remove_transition() {}, activate: method(thumbnailNative, 'activate(time)'),
    });
}
function projectionBox(monitorIndex) {
    const box = Object.assign(new ProjectionBox(), {_scrollAdjustment: shared,
        _thumbnails: workspaces.map(ws => projectionThumbnail(ws, monitorIndex)), _indicator: {get_theme_node: () => theme, allocate(b) { this.allocation = b.copy(); }, has_allocation() { return !!this.allocation; }, get_allocation_box() { return this.allocation; }},
        _porthole: {width: 1920, height: 1080}, _maxThumbnailScale: 0.1, _expandFraction: 1,
        _targetScale: 0, _scale: 0, _pendingScaleUpdate: false, _dropPlaceholderPos: -1, _dropWorkspace: -1,
        _dropPlaceholder: {visible: false, allocate_preferred_size() {}, get_position: () => [0, 0]},
        _clearDropPlaceholderLater() {}, set_allocation(b) { this.allocation = b.copy(); }, get_theme_node: () => theme,
        has_allocation() { return !!this.allocation; }, get_allocation_box() { return this.allocation; }, get_transition() { return null; },
        _updateIndicator: method(thumbnailNative, '_updateIndicator()'), _queueUpdateStates() {}, _updateStates() {},
        queue_relayout() {}, _updateShouldShow() {},
        addThumbnails(start, count) { for (let i = start; i < start + count; i++) this._thumbnails.push(projectionThumbnail(workspaces[i], monitorIndex)); },
        removeThumbnails() {}, acceptDrop: method(thumbnailNative, 'acceptDrop(source, actor, x, y, time)'), handleDragOver() { return this._thumbnails.map(t => t.metaWorkspace); },
        _activateThumbnailAtPoint: method(thumbnailNative, '_activateThumbnailAtPoint(x, y, time)'),
        _setThumbnailState(t, state) { t.state = state; },
        get_preferred_width(width) { return this.vfunc_get_preferred_width(width); },
        get_preferred_height(height) { return this.vfunc_get_preferred_height(height); },
    });
    Object.defineProperty(box, 'maxThumbnailScale', {get: () => box._maxThumbnailScale});
    manager.connect('notify::n-workspaces', method(thumbnailNative, '_workspacesChanged()').bind(box));
    shared.connectObject('notify::value', () => box._updateIndicator(), box);
    return box;
}
const localPrimary = makeView(), localSecondary = makeView();
Object.setPrototypeOf(localPrimary, ProjectionView.prototype); Object.setPrototypeOf(localSecondary, ProjectionView.prototype);
const localPrimaryBox = projectionBox(0), localSecondaryBox = projectionBox(1);
const localHost = Object.assign(new Signals(), {_workspacesView: localSecondary, _thumbnails: localSecondaryBox,
    startTouchGesture() { localSecondary.startTouchGesture(); }, endTouchGesture() { localSecondary.endTouchGesture(); }});
display._workspacesViews = [localPrimary, localHost];
overview._overview.controls._thumbnailsBox = localPrimaryBox;
const primarySlots = new context.LogicalOrder([active]), secondarySlots = new context.LogicalOrder([active]);
const lifecycle = {forcedMonitor: null, takeActivationMonitor: () => null, stacks: new Map([
    ['primary', {index: 0, order: primarySlots}], ['secondary', {index: 1, order: secondarySlots}],
]), orderForMonitor(index) { return index === 0 ? primarySlots : secondarySlots; }};
for (const [id, entry] of manager.signals) if (entry.name === 'active-workspace-changed') manager.disconnect(id);
windows.splice(0);
const stationary = {workspace: active, get_monitor: () => 1, get_workspace() { return this.workspace; },
    get_window_type: () => 1, is_on_all_workspaces: () => false, change_workspace_by_index(i) { this.workspace = workspaces[i]; }};
windows.push(stationary);
selected = 0;
context.Meta.prefs_get_dynamic_workspaces = () => true;
context.ThumbnailState.NEW = 0;
Main.wm.insertWorkspace = method(wmNative, 'insertWorkspace(pos)');
manager.append_new_workspace = () => { workspaces.push(makeWorkspace()); manager.emit('notify::n-workspaces'); };
Main.moveWindowToMonitorAndWorkspace = (window, monitor, index) => { window.monitor = monitor; window.workspace = workspaces[index]; };
const logicalIsolation = new context.Isolation(config, {resolve: () => selected}, lifecycle);
const logicalSwitcher = new context.Switcher(config, {resolve: () => selected}, {selectedMonitor: null}, logicalIsolation, lifecycle);
manager.connect('active-workspace-changed', () => logicalSwitcher.onGlobalWorkspaceChanged());
logicalIsolation.enable();
assert(logicalIsolation._session.projections);
assert.equal(localPrimaryBox.get_preferred_width(-1)[1], 192);
assert.equal(localSecondaryBox.get_preferred_width(-1)[1], 192);
assert.equal(localPrimaryBox._thumbnails.length, workspaces.length, 'native physical membership remains complete');
localPrimary.vfunc_allocate(new ActorBox());
assert.equal(localPrimary._workspaces.filter(ws => ws.box).length, 1, 'native large-view allocator sees one logical workspace');
const newWorkspace = workspaces.find(ws => ws !== active);
primarySlots.insert(1, newWorkspace); logicalIsolation.syncLogicalOrders();
assert.equal(localPrimaryBox.get_preferred_width(-1)[1], 396, 'manual expansion exposes a second primary slot');
assert.equal(localSecondaryBox.get_preferred_width(-1)[1], 192, 'secondary still has exactly one visible slot');
localPrimaryBox.vfunc_allocate(new ActorBox({x2: 396, y2: 108}));
localSecondaryBox.vfunc_allocate(new ActorBox({x2: 192, y2: 108}));
const logicalTracker = display._swipeTracker;
logicalTracker.emit('begin', 0);
assert.deepEqual(Array.from(logicalTracker.confirmation[1]), [0, 1]);
logicalTracker.emit('end', 100, 1); localPrimary._scrollAdjustment.complete();
assert.equal(active, newWorkspace); assert.equal(stationary.workspace, active);
assert.equal(secondarySlots.slots.length, 1);
assert.equal(secondarySlots.workspaces[0], active, 'inactive slot follows compensation without expanding');
const physicalBefore = workspaces.length;
workspaces.push(makeWorkspace()); manager.emit('notify::n-workspaces');
assert.equal(localPrimaryBox._thumbnails.length, physicalBefore + 1);
assert.equal(localPrimaryBox.get_preferred_width(-1)[1], 396);
assert.equal(localSecondaryBox.get_preferred_width(-1)[1], 192, 'dynamic physical append never leaks into the logical strip');
assert.deepEqual(Array.from(localPrimaryBox.handleDragOver()), Array.from(primarySlots.workspaces), 'drag targeting sees logical slots only');
const physicalArray = localPrimaryBox._thumbnails;
assert.equal(physicalArray.length, workspaces.length, 'pointer projection restores physical membership after the callback');
localPrimaryBox.vfunc_allocate(new ActorBox({x2: 396, y2: 108}));
const clickedActor = localPrimaryBox._thumbnails.find(t => t.metaWorkspace === primarySlots.workspaces[0]);
localPrimaryBox._activateThumbnailAtPoint(clickedActor.x + 1, 1, 1);
assert.equal(active, clickedActor.metaWorkspace, 'native click activates the represented logical slot');
// A placeholder insertion runs GNOME's actual insertWorkspace and acceptDrop
// through the projection. Only the target display gains a logical slot.
stationary.get_transient_for = () => null;
stationary.is_override_redirect = () => false;
const insertionWindow = {workspace: active, monitor: 0, get_monitor() { return this.monitor; },
    get_workspace() { return this.workspace; }, get_window_type: () => 1,
    is_on_all_workspaces: () => false, get_transient_for: () => null, is_override_redirect: () => false,
    change_workspace_by_index(i) { this.workspace = workspaces[i]; }};
windows.push(insertionWindow);
const beforeInsertion = workspaces.length;
const secondarySlot = secondarySlots.slots[0];
localPrimaryBox._dropWorkspace = -1; localPrimaryBox._dropPlaceholderPos = 1;
assert.equal(localPrimaryBox.acceptDrop({metaWindow: insertionWindow}, {}, 0, 0, 1), true);
assert.equal(workspaces.length, beforeInsertion + 1);
assert.equal(primarySlots.slots.length, 3);
assert.equal(primarySlots.slots[1].workspace, insertionWindow.workspace);
assert.equal(secondarySlots.slots.length, 1);
assert.equal(secondarySlots.slots[0], secondarySlot, 'insertion preserves inactive logical identity');
assert.equal(secondarySlot.workspace, stationary.workspace, 'inactive contents retain their logical slot');
assert.equal(localPrimaryBox._thumbnails.length, workspaces.length);
assert.equal(localSecondaryBox._thumbnails.length, workspaces.length);
assert.equal(localSecondaryBox.get_preferred_width(-1)[1], 192);
logicalIsolation.destroy();
const restoredNativeWidth = method(thumbnailNative, 'vfunc_get_preferred_width(_forHeight)').call(localPrimaryBox, -1)[1];
assert.equal(localPrimaryBox.get_preferred_width(-1)[1], restoredNativeWidth);
assert(restoredNativeWidth > 396, 'disable sizes all native physical actors again');
assert(localPrimaryBox._thumbnails.every(t => t.visible), 'disable restores native physical actors');
// Native active-thumbnail activation synchronously hides overview inside the
// projection callback. Teardown must restore membership before releasing it.
logicalIsolation.syncLogicalOrders();
logicalIsolation.enable();
localPrimaryBox.vfunc_allocate(new ActorBox({x2: 600, y2: 108}));
const closingProjection = logicalIsolation._session.records[0].thumbnails.projection;
const activeThumbnail = localPrimaryBox._thumbnails.find(t => t.metaWorkspace === active);
const oldHide = overview.hide;
overview.hide = () => overview.emit('hiding');
localPrimaryBox._activateThumbnailAtPoint(activeThumbnail.x + 1, 1, 1);
overview.hide = oldHide;
assert.equal(logicalIsolation._session, null);
assert.equal(closingProjection.adapter, null);
assert.equal(localPrimaryBox._thumbnails.length, workspaces.length);
assert(localPrimaryBox._thumbnails.every(t => t.visible));
logicalIsolation.refresh();
const projectionOwner = logicalIsolation._session.projections;
const destroyedProjection = logicalIsolation._session.records[0].thumbnails.projection;
localPrimaryBox.emit('destroy');
assert.equal(destroyedProjection.adapter, null);
assert.equal(destroyedProjection.box, null);
assert(!projectionOwner.adapters.has(destroyedProjection));
assert(!projectionOwner.thumbnails.has(localPrimaryBox));
assert.equal(destroyedProjection.methods._hooks.length, 0);
logicalIsolation.destroy();
console.log('PASS: native overview projection shows one clean slot, independent expansion, gesture targets, dynamic pool membership, clicks, projected DND insertion and restoration');
