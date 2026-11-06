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

import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Resolve the pointer at the moment of the gesture or shortcut. This doesn't
// require a motion listener or a background polling timer.
export class MonitorResolver {
    resolve() {
        const [x, y] = global.get_pointer();
        const monitors = Main.layoutManager.monitors;
        let closest = 0;
        let closestDistance = Infinity;
        for (let i = 0; i < monitors.length; i++) {
            const m = monitors[i];
            if (x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height)
                return m.index;
            const nearestX = Math.max(m.x, Math.min(x, m.x + m.width));
            const nearestY = Math.max(m.y, Math.min(y, m.y + m.height));
            const distance = (x - nearestX) ** 2 + (y - nearestY) ** 2;
            if (distance < closestDistance) {
                closestDistance = distance;
                closest = m.index;
            }
        }
        return closest;
    }
}

export class ConfigurationService {
    constructor(settings) {
        this.settings = settings;
        this.spanDisplays = false;
    }
    conditionallyEnableAutomaticSwitching() {
        this.spanDisplays = !Meta.prefs_get_workspaces_only_on_primary();
    }
    automaticSwitchingIsEnabled() {
        return this.spanDisplays && this.settings.get_boolean('active-monitor-only');
    }
}
