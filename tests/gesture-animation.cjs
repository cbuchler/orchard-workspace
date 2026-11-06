// Runs the installed Shell's actual MonitorGroup and controller methods with
// mock actors/signals. This is not a compositor or visual acceptance test.
// Set AMW_SHELL_ANIMATION_SOURCE to an extracted workspaceAnimation.js to run
// on a machine without the GNOME 51 shared library.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');

const shellSource = process.env.AMW_SHELL_ANIMATION_SOURCE
    ? fs.readFileSync(process.env.AMW_SHELL_ANIMATION_SOURCE, 'utf8')
    : execFileSync('/usr/bin/gresource', ['extract',
        '/usr/lib/gnome-shell/libshell-51.so',
        '/org/gnome/shell/ui/workspaceAnimation.js'], {encoding: 'utf8'});
const nativeSource = shellSource.slice(shellSource.indexOf('export const MonitorGroup'))
    .replace('export const MonitorGroup', 'const MonitorGroup')
    .replace('export class WorkspaceAnimationController', 'class WorkspaceAnimationController');
assert(nativeSource.includes('class WorkspaceAnimationController'));
const extensionSource = require('./runtime-source.cjs')();

function setup({selected = 1, primary = 0, vertical = false, rtl = false, primaryOnly = false, activeOnly = true,
    hook = true, failSignal = false, missingContainer = false, logicalIndices = null} = {}) {
    let nextId = 0;
    class Signals {
        constructor() { this.signals = new Map(); }
        connect(name, callback) {
            if (failSignal && name === 'destroy' && this._monitor?.index === 0 &&
                [...this.signals.values()].some(signal => signal.name === 'notify::progress'))
                throw new Error('simulated incompatible actor signal');
            const id = ++nextId;
            this.signals.set(id, {name, callback});
            return id;
        }
        disconnect(id) { assert(this.signals.delete(id)); }
        emit(name, ...args) {
            for (const {name: signal, callback} of [...this.signals.values()])
                if (signal === name) callback(this, ...args);
        }
        notify(name) { this.emit(`notify::${name}`); }
    }
    const pending = new Map();
    class Actor extends Signals {
        constructor(props = {}) {
            super();
            Object.assign(this, {x: 0, y: 0, translation_x: 0, translation_y: 0,
                children: [], destroyed: false}, props);
        }
        _init(props) { Object.assign(this, props); }
        add_child(child) { this.children.push(child); }
        add_constraint() {}
        set_position(x, y) { Object.assign(this, {x, y}); }
        get_text_direction() { return rtl ? 1 : 0; }
        bind_property_full() {}
        ease_property(name, target, params) {
            pending.set(this, {name, from: this[name], target, params});
        }
        remove_all_transitions() { pending.delete(this); }
        destroy() {
            this.destroyed = true;
            this.remove_all_transitions();
            this.emit('destroy');
            this.signals.clear();
        }
    }
    const state = {active: 0, selected, blocks: 0, grabs: 0, unredirect: 0, changes: 0,
        confirmations: [], errors: [], compensationMonitor: null};
    const workspaces = Array.from({length: 3}, (_, index) => ({
        index: () => index, list_windows: () => [],
        get active() { return state.active === index; },
        activate() {
            state.active = index;
            state.changes++;
            state.compensationMonitor = animation.selectedMonitor;
        },
    }));
    const monitors = [
        {index: 0, width: 1000, height: 800},
        {index: 1, width: 1400, height: 1000},
    ];
    const Main = {
        layoutManager: {monitors, primaryIndex: primary, primaryMonitor: monitors[primary]},
        overview: new Signals(), panel: {height: 30},
        createWorkspacesAdjustment: () => ({}),
        uiGroup: {insert_child_above(group) {
            if (missingContainer) delete group._container;
        }},
        wm: {blockWorkspaceUpdates: () => state.blocks++,
            unblockWorkspaceUpdates: () => state.blocks--},
        pushModal: () => { state.grabs++; return {}; },
        popModal: () => state.grabs--,
    };
    class Tracker extends Signals {
        confirmSwipe(...args) { state.confirmations.push(args); }
    }
    const ctx = vm.createContext({
        Extension: class {}, Main,
        logError: error => state.errors.push(error),
        Clutter: {Actor, get_default_text_direction: () => rtl ? 1 : 0,
            get_current_event_time: () => 123,
            Orientation: {HORIZONTAL: 0, VERTICAL: 1}, TextDirection: {RTL: 1},
            EventPhase: {CAPTURE: 0}, AnimationMode: {EASE_OUT_CUBIC: 0}},
        Shell: {ActionMode: {NORMAL: 1}}, St: {Widget: Actor,
            ThemeContext: {get_for_stage: () => ({scale_factor: 1})}},
        GObject: {ParamSpec: {double() {}}, ParamFlags: {READWRITE: 1},
            BindingFlags: {SYNC_CREATE: 1},
            registerClass: (...args) => {
                const Base = args.at(-1);
                return class extends Base {
                    constructor(...params) { super(); this._init(...params); }
                };
            }},
        Meta: {prefs_get_workspaces_only_on_primary: () => primaryOnly},
        Layout: {MonitorConstraint: class {}}, SwipeTracker: {SwipeTracker: Tracker},
        WorkspaceGroup: class extends Actor {
            constructor(workspace) { super(); this.workspace = workspace; }
        },
        WORKSPACE_SPACING: 100, WINDOW_ANIMATION_TIME: 250,
        global: {stage: {}, window_group: {}, display: {bind_property() {}},
            compositor: {disable_unredirect: () => state.unredirect++,
                enable_unredirect: () => state.unredirect--},
            workspace_manager: {
                layout_rows: vertical ? -1 : 1,
                get_n_workspaces: () => workspaces.length,
                get_active_workspace: () => workspaces[state.active],
                get_active_workspace_index: () => state.active,
                get_workspace_by_index: i => workspaces[i],
            }},
    });
    vm.runInContext(`${nativeSource}\nthis.Controller = WorkspaceAnimationController;`, ctx);
    vm.runInContext(`${extensionSource}\nthis.Animation = MonitorWorkspaceAnimation;`, ctx);
    // Construct first: Shell binds begin/update/end before our hooks exist.
    const controller = new ctx.Controller();
    const animation = new ctx.Animation(controller, {
        conditionallyEnableAutomaticSwitching() {},
        automaticSwitchingIsEnabled: () => !primaryOnly && activeOnly,
    }, {resolve: () => state.selected}, logicalIndices ? {
        workspaces: () => workspaces,
        orderForMonitor: () => ({workspaces: logicalIndices.map(index => workspaces[index])}),
    } : null);
    if (hook) animation.enable();
    const tracker = controller._swipeTracker;
    const begin = (monitor = selected) => tracker.emit('begin', monitor);
    const update = progress => tracker.emit('update', progress);
    const end = target => tracker.emit('end', 250, target);
    const tick = fraction => {
        const transitions = [...pending];
        for (const [actor, transition] of transitions)
            actor[transition.name] = transition.from + (transition.target - transition.from) * fraction;
        if (fraction === 1) {
            for (const [actor, transition] of transitions) {
                if (pending.get(actor) !== transition) continue;
                pending.delete(actor);
                transition.params.onComplete?.();
            }
        }
    };
    const groups = () => controller._switchData.monitors;
    const painted = group => [group._container.x + group._container.translation_x,
        group._container.y + group._container.translation_y];
    const clean = () => {
        assert.equal(state.blocks, 0);
        assert.equal(state.grabs, 0);
        assert.equal(state.unredirect, 0);
        assert.equal(controller._switchData, null);
        assert.equal(animation.selectedMonitor, null);
        assert.equal(pending.size, 0);
    };
    return {state, controller, animation, begin, update, end, tick, groups, painted, clean};
}

// Baseline proves the harness sees the actual all-monitor movement.
{
    const t = setup({hook: false});
    t.begin();
    const before = t.groups().map(t.painted);
    t.update(0.5);
    t.groups().forEach((group, i) => assert.notDeepEqual(t.painted(group), before[i]));
}
// All-displays mode must leave GNOME's native animation untouched.
{
    const t = setup({activeOnly: false});
    t.begin();
    assert.equal(t.animation.selectedMonitor, null);
    const before = t.groups().map(t.painted);
    t.update(0.5);
    t.groups().forEach((group, i) => assert.notDeepEqual(t.painted(group), before[i]));
    t.end(1); t.tick(1); t.clean(); t.animation.destroy();
}

for (const primary of [0, 1]) for (const selected of [0, 1])
for (const vertical of [false, true]) for (const rtl of [false, true]) {
    const t = setup({primary, selected, vertical, rtl});
    t.begin(1 - selected); // Focus selection can differ from gesture monitor.
    const groups = t.groups();
    const frozen = groups[1 - selected];
    const moving = groups[selected];
    const before = t.painted(frozen);
    assert.equal(t.controller._switchData.baseMonitorGroup, moving);
    for (const progress of [0.1, 0.4, 0.75]) {
        t.update(progress);
        assert.deepEqual(t.painted(frozen), before, 'other monitor stays fixed during drag');
        assert.notEqual(frozen.progress, 0, 'native progress must still advance');
    }
    t.state.selected = 1 - selected;
    t.end(1);
    for (const fraction of [0.25, 0.6, 0.99]) {
        t.tick(fraction);
        assert.deepEqual(t.painted(frozen), before, 'other monitor stays fixed during settling');
    }
    t.tick(1);
    assert.equal(t.state.changes, 1);
    assert.equal(t.state.compensationMonitor, selected, 'commit uses the original selected monitor');
    assert(groups.every(group => group.destroyed));
    t.clean();
    t.animation.destroy();
    assert(!Object.hasOwn(t.controller, '_prepareWorkspaceSwitch'));
}
console.log('PASS: installed GNOME controller, prebound callbacks, both monitors, horizontal/vertical/RTL, commit cleanup');

// Cancelled swipe returns to the same workspace with no activation.
{
    const t = setup(); t.begin();
    const frozen = t.groups()[0]; const before = t.painted(frozen);
    t.update(0.4); t.end(0); t.tick(0.5);
    assert.deepEqual(t.painted(frozen), before);
    t.tick(1); assert.equal(t.state.changes, 0); t.clean();
}
// Grabbing an animation before it settles uses native progress and the same
// target monitor; neither the frozen monitor nor completion jumps displays.
{
    const t = setup(); t.begin();
    const frozen = t.groups()[0]; const before = t.painted(frozen);
    t.update(0.4); t.end(1); t.tick(0.4);
    const intermediate = t.groups()[1].progress;
    t.state.selected = 0; t.begin(0);
    assert.equal(t.state.confirmations.at(-1)[2], intermediate);
    assert.equal(t.animation.selectedMonitor, 1);
    t.update(0.2); t.end(0); t.tick(0.5);
    assert.deepEqual(t.painted(frozen), before);
    t.tick(1); t.clean();
}
for (const settling of [false, true]) for (const disable of [false, true]) {
    const t = setup(); t.begin(); t.update(0.5);
    const groups = t.groups();
    if (settling) t.end(1);
    if (disable) t.animation.destroy(); else t.animation.cancel();
    t.tick(1); t.update(0.8); t.end(1);
    assert.equal(t.state.changes, 0);
    assert(groups.every(group => group.destroyed && group.signals.size === 0));
    t.clean();
}
console.log('PASS: cancellation, interrupted swipe, disable/hotplug during drag or settlement');

for (const options of [{failSignal: true}, {missingContainer: true}]) {
    const t = setup(options);
    if (options.missingContainer) t.controller._prepareWorkspaceSwitch();
    else t.begin();
    assert.equal(t.animation.selectedMonitor, null);
    if (options.failSignal) {
        assert.equal(t.state.errors.length, 1);
        assert(![...t.groups()[0].signals.values()].some(signal => signal.name === 'notify::progress'));
        t.update(0.5); t.end(1); t.tick(1); t.clean();
    } else {
        // The deliberately missing actor would also break Shell itself; only
        // verify the extension made no partial changes and added no listeners.
        t.controller._finishWorkspaceSwitch(t.controller._switchData);
        t.clean();
        t.animation.destroy();
    }
}
{
    const t = setup({primaryOnly: true}); t.begin(0);
    assert.equal(t.animation.selectedMonitor, null);
    t.update(0.5); t.end(1); t.tick(1); t.clean();
}
// A subsequent extension hook must not be overwritten on disable. A retained
// wrapper is inert when called by that extension after ours is disabled.
{
    const t = setup();
    const ours = t.controller._prepareWorkspaceSwitch;
    const later = function (...args) { return ours.apply(this, args); };
    t.controller._prepareWorkspaceSwitch = later;
    t.animation.destroy();
    assert.equal(t.controller._prepareWorkspaceSwitch, later);
    t.begin(); assert.equal(t.animation.selectedMonitor, null);
    t.update(0.5); t.end(1); t.tick(1); t.clean();
}
console.log('PASS: compatibility fallback, partial-signal rollback, primary-only mode and later extension hooks');

// Logical stacks may use only a subset of the global pool and may wrap its
// physical ordering. Native MonitorGroup must expose exactly those snap points.
for (const primary of [0, 1]) for (const selected of [0, 1]) {
    const one = setup({primary, selected, logicalIndices: [0]});
    one.begin();
    assert.equal(one.state.confirmations.at(-1)[1].length, 1);
    one.end(0); one.tick(1); one.clean(); one.animation.destroy();
    for (const logicalIndices of [[0, 2], [2, 0, 1]]) {
        const t = setup({primary, selected, logicalIndices});
        t.begin();
        const points = t.state.confirmations.at(-1)[1];
        assert.equal(points.length, logicalIndices.length);
        const before = t.painted(t.groups()[1 - selected]);
        const target = points[logicalIndices.indexOf(2)];
        t.update(target / 2);
        assert.deepEqual(t.painted(t.groups()[1 - selected]), before);
        t.state.selected = 1 - selected;
        t.end(target); t.tick(0.5);
        assert.deepEqual(t.painted(t.groups()[1 - selected]), before);
        t.tick(1);
        assert.equal(t.state.active, 2, 'native completion resolves logical slot to physical identity');
        assert.equal(t.state.compensationMonitor, selected);
        t.clean(); t.animation.destroy();
    }
    const cancel = setup({primary, selected, logicalIndices: [0, 2]});
    cancel.begin(); cancel.update(0.4); cancel.animation.destroy();
    cancel.tick(1); cancel.end(1);
    assert.equal(cancel.state.active, 0); cancel.clean();
}
console.log('PASS: desktop logical subset/single-slot/cyclic ordering, native snap targets, pointer lock and disable cancellation');
