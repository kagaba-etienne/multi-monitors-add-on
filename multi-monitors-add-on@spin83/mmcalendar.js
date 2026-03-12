/*
Copyright (C) 2014  spin83

This program is free software; you can redistribute it and/or
modify it under the terms of the GNU General Public License
as published by the Free Software Foundation; either version 2
of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program; if not, visit https://www.gnu.org/licenses/.
*/

// mmcalendar.js — Secondary-monitor date/time button for GNOME Shell 46.
//
// Proxies the primary panel's dateMenu rather than duplicating the full widget:
//   • Clock is kept in sync via GnomeDesktop.WallClock.
//   • Bell/DND icon is a local St.Icon whose visible + icon-name are kept in
//     sync with the primary panel's MessagesIndicator via GObject.bind_property.
//     The icon sits to the RIGHT of the clock, matching expected UX.
//   • Clicks redirect dateMenu.menu.sourceActor to this button so BoxPointer
//     positions the popup on the secondary monitor, then restores the original.

import Clutter from 'gi://Clutter';
import GnomeDesktop from 'gi://GnomeDesktop';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

export const MultiMonitorsDateMenuButton = GObject.registerClass(
class MultiMonitorsDateMenuButton extends PanelMenu.Button {
    _init() {
        super._init(0.5);

        // ── Button contents ───────────────────────────────────────────────
        // Layout: [ clock label ][ bell icon ]
        // Bell sits to the RIGHT of the clock, visible only when needed.
        const box = new St.BoxLayout({ style_class: 'clock-display-box' });
        this.add_child(box);
        this.add_style_class_name('clock-display');

        // Clock label.
        this._clockDisplay = new St.Label({
            style_class: 'clock',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._clockDisplay.clutter_text.y_align = Clutter.ActorAlign.CENTER;
        this._clockDisplay.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        box.add_child(this._clockDisplay);
        this.label_actor = this._clockDisplay;

        // Bell / DND icon — a fresh St.Icon to the right of the clock.
        // Important: we manage visibility via OPACITY (0 ↔ 255) rather than
        // the visible property, so the icon is always allocated the same space
        // and the clock label never shifts when the bell appears or disappears.
        const dm = Main.panel.statusArea.dateMenu;
        if (dm?._indicator) {
            this._bellIcon = new St.Icon({
                style_class: 'system-status-icon',
                y_align: Clutter.ActorAlign.CENTER,
                icon_name: dm._indicator.icon_name,
                opacity: dm._indicator.visible ? 255 : 0,
            });
            box.add_child(this._bellIcon);

            // Sync opacity from primary indicator's visible state.
            this._bellOpacityId = dm._indicator.connect('notify::visible', src => {
                this._bellIcon.opacity = src.visible ? 255 : 0;
            });
            // Sync icon name (bell, bell-disabled, etc.).
            this._bellIconBinding = dm._indicator.bind_property(
                'icon-name', this._bellIcon, 'icon-name',
                GObject.BindingFlags.SYNC_CREATE);
        }

        // Live clock via GnomeDesktop.WallClock (same underlying clock the
        // primary panel uses, so both always display the same formatted string).
        this._clock = new GnomeDesktop.WallClock();
        this._clockBinding = this._clock.bind_property(
            'clock', this._clockDisplay, 'text',
            GObject.BindingFlags.SYNC_CREATE);

        // ── Session sensitivity ───────────────────────────────────────────
        this._sessionModeId = Main.sessionMode.connect(
            'updated', this._sessionUpdated.bind(this));
        this._sessionUpdated();

        this.connect('destroy', this._onDestroy.bind(this));
    }

    _sessionUpdated() {
        this.sensitive = !Main.sessionMode.isLocked;
    }

    vfunc_event(event) {
        if (event.type() === Clutter.EventType.TOUCH_END ||
            event.type() === Clutter.EventType.BUTTON_RELEASE) {
            const dm = Main.panel.statusArea.dateMenu;
            if (dm) {
                if (!dm.menu.isOpen) {
                    // Redirect the popup's anchor to this secondary-panel
                    // button so BoxPointer opens on the right monitor.
                    this._dmOrigSource = dm.menu.sourceActor;
                    dm.menu.sourceActor = this;
                    this._dmClosedId = dm.menu.connect('open-state-changed',
                        (_m, open) => {
                            if (!open) {
                                dm.menu.sourceActor = this._dmOrigSource;
                                dm.menu.disconnect(this._dmClosedId);
                                this._dmClosedId = 0;
                            }
                        });
                }
                dm.menu.toggle();
            }
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _onDestroy() {
        // Restore sourceActor if the menu happens to be open when we're destroyed.
        if (this._dmClosedId) {
            const dm = Main.panel.statusArea.dateMenu;
            if (dm) {
                dm.menu.sourceActor = this._dmOrigSource;
                dm.menu.disconnect(this._dmClosedId);
            }
            this._dmClosedId = 0;
        }
        if (this._bellOpacityId) {
            const dm = Main.panel.statusArea.dateMenu;
            if (dm?._indicator)
                dm._indicator.disconnect(this._bellOpacityId);
            this._bellOpacityId = 0;
        }
        if (this._bellIconBinding) {
            this._bellIconBinding.unbind();
            this._bellIconBinding = null;
        }
        Main.sessionMode.disconnect(this._sessionModeId);
        this._clockBinding.unbind();
    }
});
