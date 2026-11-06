// Load the runtime modules in a VM supplied with GNOME test doubles.
const fs = require('node:fs');
const path = require('node:path');
module.exports = function runtimeSource() {
    return ['shell/methodOverrides.js', 'shell/monitor.js', 'shell/animation.js',
        'shell/lifecycle.js', 'shell/projections.js', 'shell/thumbnailGeometry.js', 'shell/thumbnails.js', 'shell/navigation.js', 'shell/overview.js', 'shell/switcher.js', 'extension.js']
        .map(file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
            .replace(/^import .*;\s*$/gm, '')
            .replace(/^export default class /gm, 'class ')
            .replace(/^export class /gm, 'class '))
        .join('\n');
};
