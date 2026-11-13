// Execute the actual extension entrypoint with lightweight service owners to
// check that removal is reachable in desktop/overview and cleaned up on disable.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const bindings = new Map(), disconnected = [];
let nextSignal = 1, removals = 0;
const signals = {connect() { return nextSignal++; }, disconnect(id) { disconnected.push(id); }};
class Service { enable() {} destroy() {} }
class Lifecycle extends Service {
    initialize() {}
    removeWorkspace() { removals++; return true; }
}
class Configuration extends Service { conditionallyEnableAutomaticSwitching() {} }
const settings = {...signals};
const ctx = vm.createContext({Meta: {KeyBindingFlags: {NONE: 0}},
    Shell: {ActionMode: {NORMAL: 1, OVERVIEW: 2}},
    Extension: class { getSettings() { return settings; } },
    MonitorResolver: Service, ConfigurationService: Configuration,
    LogicalWorkspaceLifecycle: Lifecycle, MonitorWorkspaceAnimation: Service,
    OverviewWorkspaceIsolation: Service, WorkspaceSwitcher: Service,
    WindowActivation: Service, NativeWorkspaceShortcuts: Service,
    global: {workspace_manager: {...signals}},
    Main: {layoutManager: {...signals}, wm: {_workspaceAnimation: {},
        addKeybinding(name, _settings, _flags, modes, callback) { bindings.set(name, {modes, callback}); },
        removeKeybinding(name) { assert(bindings.delete(name)); },
    }},
});
const source = fs.readFileSync(path.join(__dirname, '../extension.js'), 'utf8')
    .replace(/^import .*;\s*$/gm, '').replace('export default class ', 'class ');
vm.runInContext(source + '\nthis.ExtensionClass = SwitchWorkspacesExtension;', ctx);
const extension = new ctx.ExtensionClass(); extension.enable();
const binding = bindings.get('remove-active-display-workspace');
assert(binding, 'extension registers removal');
assert.equal(binding.modes, 3, 'removal is available in desktop and overview');
assert.equal(binding.callback(), true);
assert.equal(removals, 1);
const schema = fs.readFileSync(path.join(__dirname, '../schemas/org.gnome.shell.extensions.orchard-workspace.gschema.xml'), 'utf8');
const key = /<key name="remove-active-display-workspace"[\s\S]*?<\/key>/.exec(schema);
assert(key && key[0].includes('<Control><Super>Delete'), 'schema supplies the documented configurable default');
extension.disable();
assert.equal(bindings.size, 0, 'disable removes the removal binding with other owned bindings');
assert.equal(disconnected.length, 3);
extension.disable();
console.log('PASS: removal shortcut registration, desktop/overview action modes, schema default, callback and disable cleanup');
