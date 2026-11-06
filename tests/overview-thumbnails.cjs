// Use GNOME's own thumbnail lifecycle and drop handlers with model actors.
// This checks signal/index semantics, not live GObject or compositor rendering.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const nativePath = process.env.ORCHARD_THUMBNAIL_SOURCE;
const wmPath = process.env.ORCHARD_WM_SOURCE;
assert(nativePath && wmPath, 'Set ORCHARD_THUMBNAIL_SOURCE and ORCHARD_WM_SOURCE to extracted GNOME 51 sources');
const native = fs.readFileSync(nativePath, 'utf8');
const wmNative = fs.readFileSync(wmPath, 'utf8');
let extension = require('./runtime-source.cjs')();
extension += '\nthis.OverviewWorkspaceIsolation = OverviewWorkspaceIsolation; this.WorkspaceSwitcher = WorkspaceSwitcher;';
class Signals {
    constructor() { this.handlers = new Map(); this.next = 1; this.owners = new Map(); }
    connect(name, callback) { const id = this.next++; this.handlers.set(id, {name, callback}); return id; }
    disconnect(id) { assert(this.handlers.delete(id), 'disconnect only live signals'); }
    connectObject(name, callback, owner) { this.owners.set(owner, {name, callback}); }
    disconnectObject(owner) { this.owners.delete(owner); }
    emit(name, ...args) {
        for (const {name: signal, callback} of [...this.handlers.values(), ...this.owners.values()]) {
            if (signal === name) callback(this, ...args);
        }
    }
}
class Adjustment extends Signals {
    constructor(props = {}) { super(); Object.assign(this, {value: 0, lower: 0, upper: 4,
        page_size: 1, step_increment: 1, page_increment: 1}, props); }
    change(value) { this.value = value; this.emit('notify::value'); }
    remove_transition() {}
}
let workspaces = [], active, selected = 0;
const windows = [];
const overview = Object.assign(new Signals(), {visible: true, closing: false, hide() { this.hidden = true; }});
const manager = Object.assign(new Signals(), {
    get_n_workspaces: () => workspaces.length,
    get_workspace_by_index: index => workspaces[index],
    get_active_workspace_index: () => workspaces.indexOf(active),
    append_new_workspace() { workspaces.push(makeWorkspace()); this.emit('notify::n-workspaces'); },

});
Object.defineProperty(manager, 'n_workspaces', {get: () => workspaces.length});
function makeWorkspace() {
    const result = {index: () => {
        assert(workspaces.includes(result), 'Meta.Workspace.index() must not be called after removal');
        return workspaces.indexOf(result);
    }, activate() {
        active = result; manager.emit('active-workspace-changed');
    }};
    Object.defineProperty(result, 'active', {get: () => active === result});
    return result;
}
function makeWindow(monitor, workspace) {
    const win = {monitor, workspace, on_all_workspaces: false, get_monitor() { return this.monitor; },
        get_workspace() { return this.workspace; }, get_window_type: () => 1,
        is_on_all_workspaces: () => false, get_transient_for: () => null,
        is_override_redirect: () => false,
        change_workspace_by_index(index) { this.workspace = workspaces[index]; },
        get_compositor_private() { return {get_meta_window: () => win, meta_window: win}; },
    };
    windows.push(win); return win;
}
workspaces = Array.from({length: 4}, makeWorkspace); active = workspaces[0];
const shared = new Adjustment();
const stage = new Signals();
const Main = {overview, wm: {}, layoutManager: {primaryIndex: 0},
    moveWindowToMonitorAndWorkspace(window, monitor, index) {
        window.monitor = monitor; window.workspace = workspaces[index];
    }, xdndHandler: {},
};
const ThumbnailState = {NEW: 0, EXPANDING: 1, EXPANDED: 2, ANIMATING_IN: 3,
    NORMAL: 4, REMOVING: 5, ANIMATING_OUT: 6, ANIMATED_OUT: 7, COLLAPSING: 8, DESTROYED: 9};
const context = vm.createContext({Extension: class {}, Main, ThumbnailState, St: {Adjustment},
    Clutter: {EVENT_PROPAGATE: 0, AnimationMode: {EASE_OUT_QUAD: 1}},
    RESCALE_ANIMATION_TIME: 200, SLIDE_ANIMATION_TIME: 200,
    Meta: {WindowType: {NORMAL: 1}, prefs_get_dynamic_workspaces: () => true},
    DND: {DragMotionResult: {CONTINUE: 0, MOVE_DROP: 1, COPY_DROP: 2}},
    WORKSPACE_KEEP_ALIVE_TIME: 100,
    global: {stage, workspace_manager: manager, workspaceManager: manager,
        get_current_time: () => 1, get_window_actors: () => windows.map(win => ({meta_window: win, get_meta_window: () => win}))},
    logError(error) { throw error; },
});
function method(source, signature) {
    const start = source.indexOf(`    ${signature} {`);
    const end = source.indexOf('\n    }\n', start);
    assert(start >= 0 && end > start, `${signature} source exists`);
    return vm.runInContext(`({${source.slice(start, end + 6)}})`, context)[signature.split('(')[0]];
}
const activate = method(native, 'activate(time)');
const acceptInternal = method(native, 'acceptDropInternal(source, actor, time)');
const overInternal = method(native, 'handleDragOverInternal(source, actor, time)');
class Thumbnail extends Signals {
    constructor(metaWorkspace, monitorIndex) {
        super();
        Object.assign(this, {metaWorkspace, monitorIndex, state: 4, visible: true, _viewport: {scale_x: 1, scale_y: 1}});
    }
    has_allocation() { return false; }
    allocate() {}
    setScale() {}
    setPorthole() {}
    workspaceRemoved() { this.removed = true; }
    activate(...args) { return activate.apply(this, args); }
    acceptDropInternal(...args) { return acceptInternal.apply(this, args); }
    handleDragOverInternal(...args) { return overInternal.apply(this, args); }
    _isMyWindow(actor) { return actor.meta_window.monitor === this.monitorIndex && actor.meta_window.workspace === this.metaWorkspace; }
}
context.WorkspaceThumbnail = Thumbnail;
vm.runInContext(extension, context);
const nativeIndicator = method(native, '_updateIndicator()');
const nativeAdd = method(native, 'addThumbnails(start, count)');
const nativeRemove = method(native, 'removeThumbnails(start, count)');
const nativeChanged = method(native, '_workspacesChanged()');
const nativeDrop = method(native, 'acceptDrop(source, actor, x, y, time)');
Main.wm.insertWorkspace = method(wmNative, 'insertWorkspace(pos)');
Main.wm.keepWorkspaceAlive = () => {};
function box(monitor) {
    const box = Object.assign(new Signals(), {
        _scrollAdjustment: shared, _thumbnails: [], _monitorIndex: monitor, _dropWorkspace: -1,
        _dropPlaceholderPos: -1, _spliceIndex: -1, _shouldShow: true, _stateCounts: {0: 0, 4: 0, 5: 0},
        _porthole: {x: 0, y: 0, width: 100, height: 100}, _indicator: {allocate() {}, has_allocation: () => false},
        set_allocation() {}, has_allocation: () => false, _updateStates() {},
        _activateThumbnailAtPoint() {}, handleDragOver() {},
        _updateIndicator: nativeIndicator, addThumbnails: nativeAdd,
        removeThumbnails: nativeRemove, _workspacesChanged: nativeChanged, acceptDrop: nativeDrop,
        _queueUpdateStates() {}, queue_relayout() {}, add_child() {}, set_child_above_sibling() {},
        _updateShouldShow() {}, _setThumbnailState(t, state) { t.state = state; },
    });
    box.addThumbnails(0, workspaces.length);
    manager.connect('notify::n-workspaces', box._workspacesChanged.bind(box));
    manager.connect('active-workspace-changed', () => box._updateIndicator());
    manager.connect('workspaces-reordered', () => box._thumbnails.sort((a, b) => workspaces.indexOf(a.metaWorkspace) - workspaces.indexOf(b.metaWorkspace)));
    shared.connectObject('notify::value', () => box._updateIndicator(), box);
    return box;
}
function view() {
    const view = Object.assign(new Signals(), {_scrollAdjustment: shared, _workspaces: [],
        _overviewAdjustment: {getStateTransitionParams: () => ({transitioning: false})},
        _onScrollAdjustmentChanged() {}, _scrollToActive() {}, _updateWorkspacesState() {},
        queue_relayout() {}, startTouchGesture() {}, endTouchGesture() {},
    });
    shared.connectObject('notify::value', view._onScrollAdjustmentChanged.bind(view), view);
    return view;
}
const primary = view(), secondary = view(), primaryBox = box(0), secondaryBox = box(1);
const secondaryHost = Object.assign(new Signals(), {_workspacesView: secondary, _thumbnails: secondaryBox,
    startTouchGesture() {}, endTouchGesture() {}});
const display = {_workspacesViews: [primary, secondaryHost], _scrollAdjustment: shared,
    _endTouchGesture() { primary.endTouchGesture(); secondary.endTouchGesture(); }};
overview._overview = {controls: {_workspacesDisplay: display, _thumbnailsBox: primaryBox}};
const config = {conditionallyEnableAutomaticSwitching() {}, automaticSwitchingIsEnabled: () => true};
const resolver = {resolve: () => selected};
const isolation = new context.OverviewWorkspaceIsolation(config, resolver);
const switcher = new context.WorkspaceSwitcher(config, resolver, {selectedMonitor: null}, isolation);
manager.connect('active-workspace-changed', () => switcher.onGlobalWorkspaceChanged());
isolation.enable();
const inactiveWindows = workspaces.map(ws => makeWindow(1, ws));
const windowSlots = () => secondaryBox._thumbnails.map(t => windows.filter(w => w.monitor === 1 && w.workspace === t.metaWorkspace));
const beforeContents = windowSlots();
shared.change(0.6);
assert.equal(primaryBox._scrollAdjustment.value, 0.6);
assert.equal(secondaryBox._scrollAdjustment.value, 0, 'inactive outline stays still during swipe');
workspaces[1].activate(); shared.change(1);
assert.deepEqual(windowSlots(), beforeContents, 'inactive thumbnail contents stay in the same logical slots after compensation');
assert.equal(secondaryBox._scrollAdjustment.value, 0, 'inactive outline stays in its logical slot after commit');
assert.equal(primaryBox._scrollAdjustment.value, 1);
// Crossing monitors must preserve the strip order, not silently restore global order.
selected = 1; stage.emit('motion-event');
assert.equal(secondaryBox._scrollAdjustment.value, 0);
const target = secondaryBox._thumbnails[2].metaWorkspace;
secondaryBox._thumbnails[2].activate(1); shared.change(target.index());
assert.equal(active, target, 'thumbnail click activates its represented physical workspace');
assert.equal(secondaryBox._scrollAdjustment.value, 2, 'selected outline names the clicked logical slot');
// Ordinary window drops and external drag hover retain native target behavior.
const dragged = makeWindow(0, workspaces[0]);
secondaryBox._dropWorkspace = 1;
const dropTarget = secondaryBox._thumbnails[1].metaWorkspace;
assert.equal(secondaryBox.acceptDrop({metaWindow: dragged}, {}, 0, 0, 1), true);
assert.equal(dragged.workspace, dropTarget); assert.equal(dragged.monitor, 1);
secondaryBox._thumbnails[1].handleDragOverInternal(Main.xdndHandler, {}, 1);
assert.equal(active, dropTarget);
shared.change(active.index());
// GNOME inserts by shifting physical windows. The logical insertion slot must
// be translated, while suppressing ordinary global-switch compensation.
const preInsert = secondaryBox._thumbnails.map(t => t.metaWorkspace);
const retained = new Map(inactiveWindows.map(window => [window, preInsert.indexOf(window.workspace)]));
secondaryBox._dropWorkspace = -1; secondaryBox._dropPlaceholderPos = 1;
const insertionWindow = makeWindow(0, workspaces[0]);
assert.equal(secondaryBox.acceptDrop({metaWindow: insertionWindow}, {}, 0, 0, 1), true);
assert.equal(workspaces.length, 5);
assert.equal(secondaryBox._thumbnails[1].metaWorkspace, insertionWindow.workspace,
    'inserted thumbnail matches the visual drop slot');
for (const [window, slot] of retained) {
    const expected = slot >= 1 ? slot + 1 : slot;
    assert.equal(secondaryBox._thumbnails[expected].metaWorkspace, window.workspace,
        'native insertion preserves existing logical content on both sides of the inserted slot');
}
assert.equal(isolation.insertingWorkspace, false);
// Remove a physical workspace whose logical position differs from its index.
const removed = secondaryBox._thumbnails[3].metaWorkspace;
const removedActor = secondaryBox._thumbnails[3];
const removedIndex = workspaces.indexOf(removed);
workspaces.splice(removedIndex, 1);
for (const window of windows) if (window.workspace === removed) window.workspace = workspaces[Math.min(removedIndex, workspaces.length - 1)];
manager.emit('notify::n-workspaces');
assert.equal(removedActor.state, ThumbnailState.REMOVING, 'only the removed identity enters removal animation');
assert(secondaryBox._thumbnails.filter(t => t !== removedActor).every(t => t.state <= ThumbnailState.NORMAL));
// Complete the removal, then verify active index refresh after the async collapse.
secondaryBox._thumbnails.splice(secondaryBox._thumbnails.indexOf(removedActor), 1);
shared.change(active.index());
secondaryBox._queueUpdateStates();
assert.equal(secondaryBox._scrollAdjustment.value,
    secondaryBox._thumbnails.findIndex(t => t.metaWorkspace === active));
// A physical reorder must not undo the logical order.
const order = secondaryBox._thumbnails.map(t => t.metaWorkspace);
[workspaces[0], workspaces[1]] = [workspaces[1], workspaces[0]];
manager.emit('workspaces-reordered');
assert.deepEqual(secondaryBox._thumbnails.map(t => t.metaWorkspace), order);
// Insertion remains correct while a previous removal actor is collapsing.
const pendingWorkspace = makeWorkspace();
const pending = new Thumbnail(pendingWorkspace, 1); pending.state = ThumbnailState.REMOVING;
secondaryBox._thumbnails.splice(0, 0, pending);
secondaryBox._dropWorkspace = -1; secondaryBox._dropPlaceholderPos = 2;
const beforeRejected = secondaryBox._thumbnails.map(t => t.metaWorkspace);
assert.equal(secondaryBox.acceptDrop({}, {}, 0, 0, 1), false);
assert.deepEqual(secondaryBox._thumbnails.map(t => t.metaWorkspace), beforeRejected,
    'rejected insertion restores visual order including collapsing actors');
assert.equal(secondaryBox._dropPlaceholderPos, 2, 'rejected insertion restores its visual placeholder');
const lateDrop = makeWindow(0, active);
assert.equal(secondaryBox.acceptDrop({metaWindow: lateDrop}, {}, 0, 0, 1), true);
assert(secondaryBox._thumbnails.includes(pending), 'insertion retains pending removal actor');
assert.equal(lateDrop.workspace.index() >= 0, true, 'insertion with a pending removal targets a valid workspace');
// Start GNOME's real collapse animation and disable before it completes.
pending.state = ThumbnailState.ANIMATED_OUT;
for (const thumbnail of secondaryBox._thumbnails) {
    if (thumbnail !== pending) thumbnail.state = ThumbnailState.NORMAL;
}
let completeCollapse;
pending.ease_property = (_property, _target, options) => { completeCollapse = options.onComplete; };
pending.destroy = () => { pending.destroyed = true; };
secondaryBox._iterateStateThumbnails = method(native, '_iterateStateThumbnails(state, callback)');
secondaryBox._setThumbnailState = method(native, '_setThumbnailState(thumbnail, state)');
secondaryBox._updateStates = method(native, '_updateStates()');
secondaryBox._stateCounts = Object.fromEntries(Object.values(ThumbnailState).map(state => [state, 0]));
for (const thumbnail of secondaryBox._thumbnails) secondaryBox._stateCounts[thumbnail.state]++;
secondaryBox._animatingIndicator = false;
secondaryBox._updateStates();
assert.equal(pending.state, ThumbnailState.COLLAPSING);
assert.equal(typeof completeCollapse, 'function');
const pendingSlot = secondaryBox._thumbnails.indexOf(pending);
const retainedWrapper = secondaryBox.acceptDrop;
const adapters = isolation._session.records.map(record => record.thumbnails);
const managerSignals = manager.handlers.size;
isolation.stop();
assert.equal(primaryBox._scrollAdjustment, shared);
assert.equal(secondaryBox._scrollAdjustment, shared);
assert.equal(secondaryBox.acceptDrop, nativeDrop, 'native drop method restored');
assert.equal(secondaryBox.removeThumbnails, nativeRemove, 'native lifecycle restored');
assert.equal(manager.handlers.size, managerSignals - 2, 'session manager signals removed');
assert.equal(secondaryBox.handlers.size, 0, 'thumbnail destruction handler removed');
assert.equal(stage.handlers.size, 0);
assert.equal(secondaryBox._thumbnails.indexOf(pending), pendingSlot,
    'restoring native order preserves the collapsing actor slot');
completeCollapse();
assert.equal(pending.destroyed, true, 'native collapse can complete after extension stop');
assert(!secondaryBox._thumbnails.includes(pending));
assert.equal(secondaryBox._stateCounts[ThumbnailState.COLLAPSING], 0);
assert.deepEqual(secondaryBox._thumbnails.map(t => t.metaWorkspace.index()), workspaces.map((_, index) => index),
    'surviving actors return to physical order');
assert(adapters.every(adapter => adapter.box === null && adapter.session === null && adapter.local === null),
    'stopped adapters release shell objects and adjustment references');
assert(adapters.every(adapter => adapter.geometry === null), 'owners release stopped geometry helpers');
secondaryBox._dropWorkspace = 0;
const afterStopDrop = makeWindow(0, active);
assert.equal(retainedWrapper.call(secondaryBox, {metaWindow: afterStopDrop}, {}, 0, 0, 1), true);
assert.equal(afterStopDrop.workspace, secondaryBox._thumbnails[0].metaWorkspace,
    'a wrapper retained by another extension is an inert native pass-through after stop');
isolation.destroy();
assert.equal(isolation._orders.size, 0, 'disable releases all workspace objects');
isolation.enable();
const destroyedAdapter = isolation._session.records[0].thumbnails;
primaryBox.emit('destroy');
assert.equal(destroyedAdapter.geometry, null, 'box destruction releases its helper without a repeated stop');
assert.equal(destroyedAdapter.box, null);
isolation.destroy();
console.log('PASS: GNOME 51 thumbnail content/indicator isolation, clicks, window/XDND drops, insertion, removal, reorder, and cleanup');
