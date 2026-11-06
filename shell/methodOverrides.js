// SPDX-License-Identifier: MIT
// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

// Detach extension closures even if a later extension retains our wrapper.
export class MethodOverrides {
    constructor() {
        this._hooks = [];
    }

    add(object, name, createOverride) {
        const original = object[name];
        const hook = {object, name,
            descriptor: Object.getOwnPropertyDescriptor(object, name),
            override: createOverride(original)};
        const wrapper = function (...args) {
            return (hook.override ?? original).apply(this, args);
        };
        hook.wrapper = wrapper;
        object[name] = wrapper;
        this._hooks.push(hook);
    }

    forgetObject(object) {
        for (const hook of this._hooks) {
            if (hook.object !== object) continue;
            hook.override = null;
            hook.object = null;
            hook.descriptor = null;
        }
    }

    clear() {
        for (const hook of this._hooks.reverse()) {
            const {object, name, descriptor, wrapper} = hook;
            hook.override = null;
            hook.object = null;
            hook.descriptor = null;
            if (!object || object[name] !== wrapper) continue;
            if (descriptor) Object.defineProperty(object, name, descriptor);
            else delete object[name];
        }
        this._hooks = [];
    }
}
