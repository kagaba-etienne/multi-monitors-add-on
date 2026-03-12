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

import St from 'gi://St';
import Meta from 'gi://Meta';
import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Panel from 'resource:///org/gnome/shell/ui/panel.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as CtrlAltTab from 'resource:///org/gnome/shell/ui/ctrlAltTab.js';

import { _extension, copyClass, mmPanel } from './extension.js';
import * as MMCalendar from './mmcalendar.js';

const SHOW_ACTIVITIES_ID = 'show-activities';
const SHOW_DATE_TIME_ID = 'show-date-time';
export const AVAILABLE_INDICATORS_ID = 'available-indicators';
export const TRANSFER_INDICATORS_ID = 'transfer-indicators';

// ─── StatusIndicatorsController ──────────────────────────────────────────────
// Manages optional transfer of primary-panel status-area indicators to
// secondary panels, as configured in the extension's GSettings.

export class StatusIndicatorsController {
    constructor() {
        this._transfered_indicators = [];
        this._settings = _extension.getSettings();

        this._updatedSessionId = Main.sessionMode.connect(
            'updated', this._updateSessionIndicators.bind(this));
        this._updateSessionIndicators();

        this._extensionStateChangedId = Main.extensionManager.connect(
            'extension-state-changed',
            this._extensionStateChanged.bind(this));

        this._transferIndicatorsId = this._settings.connect(
            'changed::' + TRANSFER_INDICATORS_ID,
            this.transferIndicators.bind(this));
    }

    destroy() {
        this._settings.disconnect(this._transferIndicatorsId);
        Main.extensionManager.disconnect(this._extensionStateChangedId);
        Main.sessionMode.disconnect(this._updatedSessionId);
        this._settings.set_strv(AVAILABLE_INDICATORS_ID, []);
        this._transferBack(this._transfered_indicators);
    }

    transferBack(panel) {
        let transfer_back = this._transfered_indicators.filter(
            element => element.monitor === panel.monitorIndex);
        this._transferBack(transfer_back, panel);
    }

    transferIndicators() {
        let boxes = ['_leftBox', '_centerBox', '_rightBox'];
        let transfers = this._settings
            .get_value(TRANSFER_INDICATORS_ID).deep_unpack();

        let transfer_back = this._transfered_indicators.filter(
            element => !transfers.hasOwnProperty(element.iname));
        this._transferBack(transfer_back);

        for (let iname in transfers) {
            if (transfers.hasOwnProperty(iname) &&
                Main.panel.statusArea[iname]) {
                let monitor = transfers[iname];
                let indicator = Main.panel.statusArea[iname];
                let panel = this._findPanel(monitor);

                boxes.forEach(box => {
                    if (Main.panel[box].contains(indicator.container) &&
                        panel) {
                        this._transfered_indicators.push({ iname, box, monitor });
                        Main.panel[box].remove_child(indicator.container);
                        panel[box].insert_child_at_index(
                            indicator.container, 0);
                    }
                });
            }
        }
    }

    _findPanel(monitor) {
        if (!mmPanel) return null;
        for (let i = 0; i < mmPanel.length; i++) {
            if (mmPanel[i] &&
                mmPanel[i].monitorIndex === monitor)
                return mmPanel[i];
        }
        return null;
    }

    _transferBack(transfer_back, panel) {
        transfer_back.forEach(element => {
            this._transfered_indicators.splice(
                this._transfered_indicators.indexOf(element), 1);
            if (Main.panel.statusArea[element.iname]) {
                let indicator = Main.panel.statusArea[element.iname];
                let p = panel || this._findPanel(element.monitor);
                if (p && p[element.box] &&
                    p[element.box].contains(indicator.container)) {
                    p[element.box].remove_child(indicator.container);
                    if (element.box === '_leftBox')
                        Main.panel[element.box].insert_child_at_index(
                            indicator.container, 1);
                    else
                        Main.panel[element.box].insert_child_at_index(
                            indicator.container, 0);
                }
            }
        });
    }

    _extensionStateChanged() {
        this._findAvailableIndicators();
        this.transferIndicators();
    }

    _updateSessionIndicators() {
        let session_indicators = ['MultiMonitorsAddOn'];
        let sessionPanel = Main.sessionMode.panel;
        for (let sessionBox in sessionPanel) {
            sessionPanel[sessionBox].forEach(sesionIndicator => {
                session_indicators.push(sesionIndicator);
            });
        }
        this._session_indicators = session_indicators;
        this._available_indicators = [];
        this._findAvailableIndicators();
        this.transferIndicators();
    }

    _findAvailableIndicators() {
        let available_indicators = [];
        let statusArea = Main.panel.statusArea;
        for (let indicator in statusArea) {
            if (statusArea.hasOwnProperty(indicator) &&
                this._session_indicators.indexOf(indicator) < 0)
                available_indicators.push(indicator);
        }
        if (available_indicators.length !==
            this._available_indicators.length) {
            this._available_indicators = available_indicators;
            this._settings.set_strv(AVAILABLE_INDICATORS_ID,
                this._available_indicators);
        }
    }
}

// ─── MultiMonitorsActivitiesButton ───────────────────────────────────────────
// Reimplemented from scratch — Panel.ActivitiesButton is private in GNOME 46.

export const MultiMonitorsActivitiesButton = GObject.registerClass(
class MultiMonitorsActivitiesButton extends PanelMenu.Button {
    _init() {
        super._init(0.0, null, true);
        this.accessible_role = Atk.Role.TOGGLE_BUTTON;
        this.name = 'mmPanelActivities';

        this._label = new St.Label({
            text: _('Activities'),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_actor(this._label);
        this.label_actor = this._label;

        this._showingId = Main.overview.connect('showing', () => {
            this.add_style_pseudo_class('overview');
            this.add_accessible_state(Atk.StateType.CHECKED);
        });
        this._hidingId = Main.overview.connect('hiding', () => {
            this.remove_style_pseudo_class('overview');
            this.remove_accessible_state(Atk.StateType.CHECKED);
        });
    }

    vfunc_event(event) {
        if (event.type() === Clutter.EventType.TOUCH_END ||
            event.type() === Clutter.EventType.BUTTON_RELEASE)
            Main.overview.toggle();
        return Clutter.EVENT_PROPAGATE;
    }

    _onDestroy() {
        Main.overview.disconnect(this._showingId);
        Main.overview.disconnect(this._hidingId);
        super._onDestroy();
    }
});

// ─── Panel item map ───────────────────────────────────────────────────────────
// AppMenuButton was removed in GNOME 40 and is not included.

const MULTI_MONITOR_PANEL_ITEM_IMPLEMENTATIONS = {
    activities: MultiMonitorsActivitiesButton,
    dateMenu: MMCalendar.MultiMonitorsDateMenuButton,
};

// ─── MultiMonitorsPanel ───────────────────────────────────────────────────────

export const MultiMonitorsPanel = (() => {
    let MultiMonitorsPanel = class MultiMonitorsPanel extends St.Widget {
        _init(monitorIndex, mmPanelBox) {
            super._init({ name: 'panel', reactive: true });

            this.monitorIndex = monitorIndex;
            this.set_offscreen_redirect(Clutter.OffscreenRedirect.ALWAYS);

            this._sessionStyle = null;
            this.statusArea = {};
            this.menuManager = new PopupMenu.PopupMenuManager(this);

            this._leftBox = new St.BoxLayout({ name: 'panelLeft' });
            this.add_child(this._leftBox);
            this._centerBox = new St.BoxLayout({ name: 'panelCenter' });
            this.add_child(this._centerBox);
            this._rightBox = new St.BoxLayout({ name: 'panelRight' });
            this.add_child(this._rightBox);

            // PanelCorner was removed in GNOME 42 — not added.

            this._showingId = Main.overview.connect('showing', () => {
                this.add_style_pseudo_class('overview');
            });
            this._hidingId = Main.overview.connect('hiding', () => {
                this.remove_style_pseudo_class('overview');
            });

            mmPanelBox.panelBox.add_child(this);
            Main.ctrlAltTabManager.addGroup(
                this, _('Top Bar'), 'focus-top-bar-symbolic',
                { sortGroup: CtrlAltTab.SortGroup.TOP });

            this._updatedId = Main.sessionMode.connect(
                'updated', this._updatePanel.bind(this));
            this._workareasChangedId = global.display.connect(
                'workareas-changed', () => this.queue_relayout());
            this._updatePanel();

            this._settings = _extension.getSettings();
            this._showActivitiesId = this._settings.connect(
                'changed::' + SHOW_ACTIVITIES_ID,
                this._showActivities.bind(this));
            this._showActivities();

            this._showDateTimeId = this._settings.connect(
                'changed::' + SHOW_DATE_TIME_ID,
                this._showDateTime.bind(this));
            this._showDateTime();

            this.connect('destroy', this._onDestroy.bind(this));
        }

        _onDestroy() {
            global.display.disconnect(this._workareasChangedId);
            Main.overview.disconnect(this._showingId);
            Main.overview.disconnect(this._hidingId);
            this._settings.disconnect(this._showActivitiesId);
            this._settings.disconnect(this._showDateTimeId);
            Main.ctrlAltTabManager.removeGroup(this);
            Main.sessionMode.disconnect(this._updatedId);
        }

        _showActivities() {
            let indicator = this.statusArea['activities'];
            if (!indicator) return;
            indicator.visible =
                this._settings.get_boolean(SHOW_ACTIVITIES_ID);
        }

        _showDateTime() {
            let indicator = this.statusArea['dateMenu'];
            if (!indicator) return;
            indicator.visible =
                this._settings.get_boolean(SHOW_DATE_TIME_ID);
        }

        vfunc_get_preferred_width(_forHeight) {
            if (Main.layoutManager.monitors.length > this.monitorIndex)
                return [0,
                    Main.layoutManager.monitors[this.monitorIndex].width];
            return [0, 0];
        }

        _hideIndicators() {
            for (let role in MULTI_MONITOR_PANEL_ITEM_IMPLEMENTATIONS) {
                let indicator = this.statusArea[role];
                if (indicator)
                    indicator.container.hide();
            }
        }

        _ensureIndicator(role) {
            let indicator = this.statusArea[role];
            if (indicator) {
                indicator.container.show();
                return null;
            }
            let constructor = MULTI_MONITOR_PANEL_ITEM_IMPLEMENTATIONS[role];
            if (!constructor)
                return null;
            indicator = new constructor(this);
            this.statusArea[role] = indicator;
            return indicator;
        }

        _addToPanelBox(role, indicator, position, box) {
            let container = indicator.container;
            let parent = container.get_parent();
            if (parent) {
                if (parent === box) {
                    if (position !== -1)
                        box.set_child_at_index(container, position);
                    return;
                }
                parent.remove_child(container);
            }
            if (position === -1)
                box.add_child(container);
            else
                box.insert_child_at_index(container, position);
            if (indicator.menu)
                this.menuManager.addMenu(indicator.menu);
        }

        _updatePanel() {
            let panelSet = Main.sessionMode.panel;
            if (!panelSet) return;

            this._hideIndicators();

            const boxes = {
                left: this._leftBox,
                center: this._centerBox,
                right: this._rightBox,
            };

            for (let [boxName, roles] of Object.entries(panelSet)) {
                let box = boxes[boxName];
                if (!box || !roles) continue;
                for (let role of roles) {
                    let indicator = this._ensureIndicator(role);
                    if (indicator !== null)
                        this._addToPanelBox(role, indicator, -1, box);
                }
            }
        }

        _getDraggableWindowForPosition(stageX) {
            let workspaceManager = global.workspace_manager;
            const windows =
                workspaceManager.get_active_workspace().list_windows();
            const allWindowsByStacking =
                global.display.sort_windows_by_stacking(windows).reverse();
            return allWindowsByStacking.find(metaWindow => {
                let rect = metaWindow.get_frame_rect();
                return metaWindow.get_monitor() === this.monitorIndex &&
                    metaWindow.showing_on_its_workspace() &&
                    metaWindow.get_window_type() !== Meta.WindowType.DESKTOP &&
                    metaWindow.maximized_vertically &&
                    stageX > rect.x && stageX < rect.x + rect.width;
            });
        }
    };

    // Copy remaining Panel.Panel helpers (e.g. vfunc_button_press_event,
    // vfunc_scroll_event). Methods already defined above are skipped.
    copyClass(Panel.Panel, MultiMonitorsPanel);
    return GObject.registerClass(MultiMonitorsPanel);
})();
