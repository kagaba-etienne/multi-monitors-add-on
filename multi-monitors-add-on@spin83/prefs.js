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

// prefs.js — Extension preferences for GNOME Shell 46.
// Uses GTK 4 + libadwaita via ExtensionPreferences.

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import {
    ExtensionPreferences,
    gettext as _,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const SHOW_INDICATOR_ID = 'show-indicator';
const SHOW_PANEL_ID = 'show-panel';
const SHOW_ACTIVITIES_ID = 'show-activities';
const SHOW_DATE_TIME_ID = 'show-date-time';
const THUMBNAILS_SLIDER_POSITION_ID = 'thumbnails-slider-position';
const AVAILABLE_INDICATORS_ID = 'available-indicators';
const TRANSFER_INDICATORS_ID = 'transfer-indicators';
const ENABLE_HOT_CORNERS = 'enable-hot-corners';

const Columns = {
    INDICATOR_NAME: 0,
    MONITOR_NUMBER: 1,
};

// ─── ExtensionPreferences entry point ─────────────────────────────────────────

export default class MultiMonitorsAddOnPreferences extends ExtensionPreferences {

    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const desktopSettings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.interface',
        });

        const page = new Adw.PreferencesPage();
        window.add(page);

        // ── General toggles ──────────────────────────────────────────────
        const generalGroup = new Adw.PreferencesGroup({
            title: _('General'),
        });
        page.add(generalGroup);

        this._addSwitchRow(generalGroup,
            _('Show indicator on Top Panel'),
            SHOW_INDICATOR_ID, settings);
        this._addSwitchRow(generalGroup,
            _('Show Panel on additional monitors'),
            SHOW_PANEL_ID, settings);
        this._addSwitchRow(generalGroup,
            _('Show Activities button on additional monitors'),
            SHOW_ACTIVITIES_ID, settings);
        this._addSwitchRow(generalGroup,
            _('Show Date/Time button on additional monitors'),
            SHOW_DATE_TIME_ID, settings);
        this._addSwitchRow(generalGroup,
            _('Enable hot corners on all monitors'),
            ENABLE_HOT_CORNERS, desktopSettings);

        // ── Workspace thumbnails ─────────────────────────────────────────
        const thumbnailGroup = new Adw.PreferencesGroup({
            title: _('Workspace Thumbnails'),
        });
        page.add(thumbnailGroup);

        const thumbnailItems = [
            { id: 'none',  label: _('Disabled') },
            { id: 'right', label: _('Right') },
            { id: 'left',  label: _('Left') },
            { id: 'auto',  label: _('Auto (based on monitor position)') },
        ];
        this._addComboRow(thumbnailGroup,
            _('Thumbnail slider position on additional monitors'),
            THUMBNAILS_SLIDER_POSITION_ID, settings, thumbnailItems);

        // ── Indicator transfer ───────────────────────────────────────────
        const indicatorGroup = new Adw.PreferencesGroup({
            title: _('Indicator Transfer'),
            description: _('Move status-area indicators from the primary ' +
                           'Top Bar to a secondary monitor panel.'),
        });
        page.add(indicatorGroup);

        this._buildIndicatorList(indicatorGroup, settings, window);
    }

    // ── Row builder helpers ───────────────────────────────────────────────

    _addSwitchRow(group, label, key, settings) {
        const row = new Adw.ActionRow({ title: label });
        const toggle = new Gtk.Switch({ valign: Gtk.Align.CENTER });
        settings.bind(key, toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        row.add_suffix(toggle);
        row.activatable_widget = toggle;
        group.add(row);
    }

    _addComboRow(group, label, key, settings, items) {
        const model = new Gtk.StringList();
        items.forEach(item => model.append(item.label));

        const row = new Adw.ComboRow({ title: label, model });

        // Sync combo → setting.
        row.connect('notify::selected', () => {
            const sel = row.get_selected();
            if (sel >= 0 && sel < items.length)
                settings.set_string(key, items[sel].id);
        });

        // Sync setting → combo (including initial value).
        const syncFromSettings = () => {
            const id = settings.get_string(key);
            const idx = items.findIndex(item => item.id === id);
            if (idx >= 0 && idx !== row.get_selected())
                row.set_selected(idx);
        };
        settings.connect('changed::' + key, syncFromSettings);
        syncFromSettings();

        group.add(row);
    }

    // ── Indicator transfer list ───────────────────────────────────────────

    _buildIndicatorList(group, settings, parentWindow) {
        this._settings = settings;

        this._store = new Gtk.ListStore();
        this._store.set_column_types([GObject.TYPE_STRING, GObject.TYPE_INT]);

        const treeView = new Gtk.TreeView({
            model: this._store,
            hexpand: true,
            height_request: 130,
        });
        treeView.get_selection().set_mode(Gtk.SelectionMode.SINGLE);

        const col = new Gtk.TreeViewColumn({
            expand: true,
            title: _('Indicator → monitor'),
        });
        const nameR = new Gtk.CellRendererText();
        const monR = new Gtk.CellRendererText();
        col.pack_start(nameR, true);
        col.add_attribute(nameR, 'text', Columns.INDICATOR_NAME);
        col.pack_start(monR, false);
        col.add_attribute(monR, 'text', Columns.MONITOR_NUMBER);
        treeView.append_column(col);

        settings.connect('changed::' + TRANSFER_INDICATORS_ID,
            () => this._updateIndicators(settings));
        this._updateIndicators(settings);

        // Button bar.
        const btnBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            margin_top: 6,
        });
        const addBtn = new Gtk.Button({ icon_name: 'list-add-symbolic' });
        addBtn.connect('clicked',
            () => this._addIndicator(settings, treeView, parentWindow));
        btnBox.append(addBtn);

        const removeBtn = new Gtk.Button({ icon_name: 'list-remove-symbolic' });
        removeBtn.connect('clicked',
            () => this._removeIndicator(settings, treeView));
        btnBox.append(removeBtn);

        const container = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 0,
            margin_top: 6,
            margin_bottom: 6,
        });
        container.append(treeView);
        container.append(btnBox);

        // Wrap in an ActionRow so it fits the Adw.PreferencesGroup pattern.
        const row = new Adw.ActionRow();
        row.set_child(container);
        group.add(row);
    }

    _updateIndicators(settings) {
        this._store.clear();
        const transfers = settings
            .get_value(TRANSFER_INDICATORS_ID).deep_unpack();
        for (const indicator in transfers) {
            if (transfers.hasOwnProperty(indicator)) {
                const iter = this._store.append();
                this._store.set(iter,
                    [Columns.INDICATOR_NAME, Columns.MONITOR_NUMBER],
                    [indicator, transfers[indicator]]);
            }
        }
    }

    _addIndicator(settings, treeView, parentWindow) {
        const dialog = new Gtk.Dialog({
            title: _('Select indicator'),
            transient_for: parentWindow,
            modal: true,
            use_header_bar: 1,
        });
        dialog.add_button(_('Cancel'), Gtk.ResponseType.CANCEL);
        dialog.add_button(_('Add'), Gtk.ResponseType.OK);
        dialog.set_default_response(Gtk.ResponseType.OK);

        const grid = new Gtk.Grid({
            column_spacing: 10,
            row_spacing: 15,
            margin_top: 10,
            margin_bottom: 10,
            margin_start: 10,
            margin_end: 10,
            orientation: Gtk.Orientation.VERTICAL,
        });

        // Available indicators list.
        const dlgStore = new Gtk.ListStore();
        dlgStore.set_column_types([GObject.TYPE_STRING]);

        const dlgView = new Gtk.TreeView({
            model: dlgStore,
            hexpand: true,
            vexpand: true,
        });
        dlgView.get_selection().set_mode(Gtk.SelectionMode.SINGLE);
        const dlgCol = new Gtk.TreeViewColumn({
            expand: true,
            title: _('Available indicators'),
        });
        const dlgR = new Gtk.CellRendererText();
        dlgCol.pack_start(dlgR, true);
        dlgCol.add_attribute(dlgR, 'text', 0);
        dlgView.append_column(dlgCol);

        const populateAvailable = () => {
            const transfers = settings
                .get_value(TRANSFER_INDICATORS_ID).unpack();
            dlgStore.clear();
            settings.get_strv(AVAILABLE_INDICATORS_ID).forEach(indicator => {
                if (!transfers.hasOwnProperty(indicator)) {
                    const iter = dlgStore.append();
                    dlgStore.set(iter, [0], [indicator]);
                }
            });
        };
        const availId = settings.connect(
            'changed::' + AVAILABLE_INDICATORS_ID, populateAvailable);
        const transId = settings.connect(
            'changed::' + TRANSFER_INDICATORS_ID, populateAvailable);
        populateAvailable();
        grid.append(dlgView);

        // Monitor index spinner.
        const monRow = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 20,
            margin_top: 10,
            hexpand: true,
        });
        monRow.append(new Gtk.Label({
            label: _('Monitor index:'),
            halign: Gtk.Align.START,
            hexpand: true,
        }));
        const display = Gdk.Display.get_default();
        const nMonitors = display
            ? display.get_monitors().get_n_items()
            : 1;
        const adj = new Gtk.Adjustment({
            lower: 0,
            upper: Math.max(0, nMonitors - 1),
            step_increment: 1,
            value: Math.max(0, nMonitors - 1),
        });
        const spinner = new Gtk.SpinButton({
            adjustment: adj,
            numeric: true,
            halign: Gtk.Align.END,
        });
        monRow.append(spinner);
        grid.append(monRow);

        dialog.get_content_area().append(grid);

        dialog.connect('response', (_dlg, id) => {
            settings.disconnect(availId);
            settings.disconnect(transId);
            if (id === Gtk.ResponseType.OK) {
                const [any, , iter] = dlgView.get_selection().get_selected();
                if (any) {
                    const indicator = dlgStore.get_value(iter, 0);
                    const transfers = settings
                        .get_value(TRANSFER_INDICATORS_ID).deep_unpack();
                    if (!transfers.hasOwnProperty(indicator)) {
                        transfers[indicator] = Math.round(adj.get_value());
                        settings.set_value(TRANSFER_INDICATORS_ID,
                            new GLib.Variant('a{si}', transfers));
                    }
                }
            }
            dialog.destroy();
        });

        dialog.present();
    }

    _removeIndicator(settings, treeView) {
        const [any, , iter] = treeView.get_selection().get_selected();
        if (any) {
            const indicator =
                this._store.get_value(iter, Columns.INDICATOR_NAME);
            const transfers = settings
                .get_value(TRANSFER_INDICATORS_ID).deep_unpack();
            if (transfers.hasOwnProperty(indicator)) {
                delete transfers[indicator];
                settings.set_value(TRANSFER_INDICATORS_ID,
                    new GLib.Variant('a{si}', transfers));
            }
        }
    }
}
