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
// In GNOME 46 the old internal helper classes (FreezableBinLayout,
// TodayButton, CalendarColumnLayout, EventsSection, MessagesIndicator,
// NotificationSection, CalendarMessageList from the old codebase) were either
// made private or removed.  This module provides a simplified but functional
// replacement using the public GNOME 46 Calendar API.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GnomeDesktop from 'gi://GnomeDesktop';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as Calendar from 'resource:///org/gnome/shell/ui/calendar.js';

// ─── MultiMonitorsDateMenuButton ──────────────────────────────────────────────
// A PanelMenu.Button that shows a live clock label.  Clicking it opens a
// popup containing a calendar widget and the notification message list,
// mirroring the primary panel's date-menu behaviour with the public API.

export const MultiMonitorsDateMenuButton = GObject.registerClass(
class MultiMonitorsDateMenuButton extends PanelMenu.Button {
    _init() {
        super._init(0.5);

        // ── Clock label ───────────────────────────────────────────────────
        this._clockDisplay = new St.Label({
            style_class: 'clock',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._clockDisplay.clutter_text.y_align = Clutter.ActorAlign.CENTER;
        this._clockDisplay.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

        let box = new St.BoxLayout({ style_class: 'clock-display-box' });
        box.add_child(this._clockDisplay);
        this.add_actor(box);
        this.add_style_class_name('clock-display');
        this.label_actor = this._clockDisplay;

        // GnomeDesktop.WallClock provides the formatted clock string and
        // emits notify::clock whenever the display string changes.
        this._clock = new GnomeDesktop.WallClock();
        this._clockBinding = this._clock.bind_property(
            'clock',
            this._clockDisplay, 'text',
            GObject.BindingFlags.SYNC_CREATE);
        this._clockTimezoneId = this._clock.connect(
            'notify::timezone', this._onTimezoneChanged.bind(this));

        // ── Popup layout ──────────────────────────────────────────────────
        // Left column: CalendarMessageList (notifications + DND + Clear)
        // Right column: Calendar widget
        let hbox = new St.BoxLayout({ name: 'calendarArea' });
        this.menu.box.add_child(hbox);

        // Left: message list (notifications, DND switch, clear button).
        // Calendar.CalendarMessageList is public in GNOME 46.
        this._messageList = new Calendar.CalendarMessageList();
        hbox.add_child(this._messageList);

        // Right: calendar
        let vbox = new St.BoxLayout({
            style_class: 'datemenu-calendar-column',
            vertical: true,
        });
        hbox.add_child(vbox);

        this._calendar = new Calendar.Calendar();
        vbox.add_child(this._calendar);

        // ── Session + date selection ──────────────────────────────────────
        this._sessionModeUpdatedId = Main.sessionMode.connect(
            'updated', this._sessionUpdated.bind(this));
        this._sessionUpdated();

        // When the menu opens, jump to today.
        this._openStateChangedId = this.menu.connect(
            'open-state-changed', (_menu, isOpen) => {
                if (isOpen) {
                    let now = new Date();
                    this._calendar.setDate(now);
                }
            });

        this.connect('destroy', this._onDestroy.bind(this));
    }

    _onTimezoneChanged() {
        this._calendar.updateTimeZone();
    }

    _sessionUpdated() {
        this.sensitive = !Main.sessionMode.isLocked;
    }

    _onDestroy() {
        if (this._openStateChangedId) {
            this.menu.disconnect(this._openStateChangedId);
            this._openStateChangedId = 0;
        }
        Main.sessionMode.disconnect(this._sessionModeUpdatedId);
        this._clock.disconnect(this._clockTimezoneId);
        this._clockBinding.unbind();
    }
});
