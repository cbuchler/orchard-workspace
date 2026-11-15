// Exercise the actual entrypoint's rollback boundary with faulting services.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('extension.js', 'utf8')
    .replace(/^import .*;\s*$/gm, '').replace('export default class ', 'class ') +
    '\nthis.ExtensionUnderTest = SwitchWorkspacesExtension;';

function setup(fault) {
    const resources = new Set(), constructed = [], destroyed = [], saves = [];
    const failure = new Error(`injected ${fault}`);
    const step = name => { if (name === fault) throw failure; };
    function service(name) {
        return class {
            constructor() { step(name); constructed.push(name); }
            enable() { resources.add(name); step(`${name}.enable`); }
            destroy() { resources.delete(name); destroyed.push(name); }
        };
    }
    const Lifecycle = class extends service('lifecycle') {
        initialize() { resources.add('lifecycle'); step('initialize'); }
        destroy({saveLayout}) {
            try { this.persistence?.destroy({save: saveLayout}); }
            finally { super.destroy(); }
        }
    };
    const Persistence = class extends service('persistence') {
        restore() { resources.add('persistence'); step('restore'); }
        destroy({save}) {
            saves.push(save);
            super.destroy();
            if (save) step('flush');
        }
    };
    let binding = 0, signal = 0;
    const signalObject = {connect() { step(`signal${++signal}`); resources.add(`signal${signal}`); return signal; },
        disconnect(id) { assert(resources.delete(`signal${id}`)); }};
    const settings = {...signalObject};
    const context = vm.createContext({
        assertShellCompatibility() {},
        Extension: class { getSettings() { step('settings'); return settings; } },
        ConfigurationService: class { conditionallyEnableAutomaticSwitching() {} },
        MonitorResolver: class {},
        LogicalWorkspaceLifecycle: Lifecycle,
        LogicalLayoutPersistence: Persistence,
        MonitorWorkspaceAnimation: service('animation'),
        OverviewWorkspaceIsolation: service('overview'),
        WorkspaceSwitcher: class {},
        WindowActivation: service('activation'),
        NativeWorkspaceShortcuts: service('shortcuts'),
        WorkspaceStackingCompatibility: service('compatibility'),
        Meta: {KeyBindingFlags: {NONE: 0}}, Shell: {ActionMode: {NORMAL: 1, OVERVIEW: 2}},
        Main: {wm: {addKeybinding(name) { step(`binding${++binding}`); resources.add(name); },
            removeKeybinding(name) { assert(resources.delete(name)); }}, layoutManager: signalObject},
        global: {workspace_manager: signalObject},
    });
    vm.runInContext(source, context);
    return {extension: new context.ExtensionUnderTest(), resources, constructed, destroyed, saves, failure};
}
for (const fault of ['settings', 'lifecycle', 'initialize', 'persistence', 'restore', 'animation',
    'overview', 'activation', 'shortcuts', 'compatibility', 'compatibility.enable',
    'activation.enable', 'animation.enable', 'overview.enable', 'binding2', 'signal2',
    'lifecycle.enable', 'shortcuts.enable']) {
    const s = setup(fault);
    assert.throws(() => s.extension.enable(), error => error === s.failure);
    assert.equal(s.extension._state, null, fault);
    assert.equal(s.resources.size, 0, `${fault}: resources left: ${[...s.resources]}`);
    assert.deepEqual([...s.destroyed].sort(), [...s.constructed].sort(), `${fault}: created helper not destroyed`);
    assert(s.saves.every(save => save === false), `${fault}: failed startup overwrote saved layout`);
    s.extension.disable(); // Shell can disable again after a failed enable.
}
for (const fault of [null, 'flush']) {
    const s = setup(fault);
    s.extension.enable();
    if (fault) assert.throws(() => s.extension.disable(), error => error === s.failure);
    else s.extension.disable();
    assert.equal(s.extension._state, null);
    assert.equal(s.resources.size, 0, 'normal disable/write failure must finish cleanup');
    assert.deepEqual([...s.destroyed].sort(), [...s.constructed].sort());
    assert.deepEqual(s.saves, [true]);
}
console.log('PASS: startup failures before/during restoration, constructors, hooks, keys and signals roll back; failed startup preserves settings; disable finishes after a save failure');
