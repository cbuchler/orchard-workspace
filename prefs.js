// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

/* SPDX-License-Identifier: MIT */
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class Preferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({title: 'Workspace switching'});
        const row = new Adw.SwitchRow({
            title: 'Switch only the active display',
            subtitle: 'Turn off to switch all displays together.',
        });
        window.add(page);
        page.add(group);
        group.add(row);
        this.getSettings().bind('active-monitor-only', row, 'active', Gio.SettingsBindFlags.DEFAULT);
    }
}
