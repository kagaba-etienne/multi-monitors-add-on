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
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';

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
        this.add_child(this._label);
        this.label_actor = this._label;

        this._showingId = Main.overview.connect('showing', () => {
            this.add_style_pseudo_class('overview');
            this.add_style_pseudo_class('checked');
            this.add_accessible_state(Atk.StateType.CHECKED);
        });
        this._hidingId = Main.overview.connect('hiding', () => {
            this.remove_style_pseudo_class('overview');
            this.remove_style_pseudo_class('checked');
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

// ─── MultiMonitorsQuickSettings ───────────────────────────────────────────────
// Proxy for the right side of the secondary panel.  Uses Clutter.Clone to
// mirror the live icon row from the primary panel's quickSettings button
// (battery level, wifi signal, volume, etc. all update automatically).
// Clicks are forwarded to toggle the primary panel's quickSettings menu.

export const MultiMonitorsQuickSettings = GObject.registerClass(
class MultiMonitorsQuickSettings extends PanelMenu.Button {
    _init() {
        super._init(0.0, null, true);

        const qs = Main.panel.statusArea.quickSettings;
        if (qs) {
            // _indicators is the St.BoxLayout that holds all the status icons.
            const source = qs._indicators ?? qs;
            this._cloneSource = source;
            this._clone = new Clutter.Clone({ source });
            this.add_child(this._clone);

            // Keep the clone's allocation in lock-step with the source row.
            // During early login indicators can appear late (e.g. Wi-Fi), and
            // forcing relayout prevents temporary icon squashing.
            this._syncCloneLayout = () => {
                if (!this._clone || !this._cloneSource)
                    return;

                let width = this._cloneSource.width;
                let height = this._cloneSource.height;

                if (width <= 0 || height <= 0) {
                    const [, natWidth] = this._cloneSource.get_preferred_width(-1);
                    const [, natHeight] = this._cloneSource.get_preferred_height(-1);
                    width = natWidth;
                    height = natHeight;
                }

                if (width > 0 && height > 0)
                    this._clone.set_size(width, height);

                this.queue_relayout();
            };

            this._sourceAllocationId = source.connect(
                'notify::allocation', this._syncCloneLayout);
            // Child changes can resize the indicator row as services appear
            // during session startup (e.g. network indicator).
            this._sourceChildAddedId = 0;
            this._sourceChildRemovedId = 0;
            try {
                this._sourceChildAddedId = source.connect(
                    'child-added', this._syncCloneLayout);
                this._sourceChildRemovedId = source.connect(
                    'child-removed', this._syncCloneLayout);
            } catch (e) {
                // Some actors may not expose child signals; allocation sync
                // above is still enough to keep the clone usable.
                this._sourceChildAddedId = 0;
                this._sourceChildRemovedId = 0;
            }

            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._syncCloneLayout();
                return GLib.SOURCE_REMOVE;
            });

            // Mirror the primary menu's open state as :checked so the pill
            // stays visible while the quick-settings panel is open.
            this._qsMenuStateId = qs.menu.connect('open-state-changed',
                (_m, open) => {
                    if (open)
                        this.add_style_pseudo_class('checked');
                    else
                        this.remove_style_pseudo_class('checked');
                });
        } else {
            this.add_child(new St.Icon({
                icon_name: 'emblem-system-symbolic',
                style_class: 'system-status-icon',
            }));
        }
    }

    vfunc_event(event) {
        if (event.type() === Clutter.EventType.TOUCH_END ||
            event.type() === Clutter.EventType.BUTTON_RELEASE) {
            const qs = Main.panel.statusArea.quickSettings;
            if (qs) {
                if (!qs.menu.isOpen) {
                    // Redirect the menu's source actor to this secondary-panel
                    // button so BoxPointer positions the popup on this monitor.
                    this._qsOrigSource = qs.menu.sourceActor;
                    qs.menu.sourceActor = this;
                    this._qsClosedId = qs.menu.connect('open-state-changed',
                        (_m, open) => {
                            if (!open) {
                                qs.menu.sourceActor = this._qsOrigSource;
                                qs.menu.disconnect(this._qsClosedId);
                                this._qsClosedId = 0;
                            }
                        });
                }
                qs.menu.toggle();
            }
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _onDestroy() {
        if (this._cloneSource) {
            if (this._sourceAllocationId)
                this._cloneSource.disconnect(this._sourceAllocationId);
            if (this._sourceChildAddedId)
                this._cloneSource.disconnect(this._sourceChildAddedId);
            if (this._sourceChildRemovedId)
                this._cloneSource.disconnect(this._sourceChildRemovedId);

            this._sourceAllocationId = 0;
            this._sourceChildAddedId = 0;
            this._sourceChildRemovedId = 0;
            this._cloneSource = null;
        }

        if (this._qsMenuStateId) {
            const qs = Main.panel.statusArea.quickSettings;
            if (qs?.menu)
                qs.menu.disconnect(this._qsMenuStateId);
            this._qsMenuStateId = 0;
        }
        if (this._qsClosedId) {
            const qs = Main.panel.statusArea.quickSettings;
            if (qs) {
                qs.menu.sourceActor = this._qsOrigSource;
                qs.menu.disconnect(this._qsClosedId);
            }
            this._qsClosedId = 0;
        }
        if (this._clone) {
            this._clone.source = null;
            this._clone = null;
        }
        super._onDestroy();
    }
});

// ─── Panel item map ───────────────────────────────────────────────────────────
// AppMenuButton was removed in GNOME 40 and is not included.

const MULTI_MONITOR_PANEL_ITEM_IMPLEMENTATIONS = {
    activities: MultiMonitorsActivitiesButton,
    dateMenu: MMCalendar.MultiMonitorsDateMenuButton,
    quickSettings: MultiMonitorsQuickSettings,
};

// ─── BlurRepaintEffect ────────────────────────────────────────────────────────
// Shell.BlurEffect(BACKGROUND) does not repaint when the actors above it
// change (e.g. panel-button :hover box-shadows), which causes a stale blurred
// version of those shadows to appear as dark rectangles behind the buttons.
// This lightweight Clutter.Effect, attached to the blur actor, forces the blur
// to queue a repaint every paint cycle so it always samples a clean background.
// Reference: https://gitlab.gnome.org/GNOME/gnome-shell/-/issues/2857
const BlurRepaintEffect = GObject.registerClass(
class BlurRepaintEffect extends Clutter.Effect {
    _init(blurEffect) {
        super._init();
        this._blurEffect = blurEffect;
        this._counter = 0;
    }

    vfunc_paint(node, paintContext, paintFlags) {
        if (this._counter === 0) {
            this._counter = 2;
            this._blurEffect.queue_repaint();
        } else {
            this._counter--;
        }
        super.vfunc_paint(node, paintContext, paintFlags);
    }
});

// ─── MultiMonitorsPanel ───────────────────────────────────────────────────────

export const MultiMonitorsPanel = (() => {
    let MultiMonitorsPanel = class MultiMonitorsPanel extends St.Widget {
        _init(monitorIndex, mmPanelBox) {
            super._init({ name: 'panel', reactive: true });

            this.monitorIndex = monitorIndex;
            // Note: set_offscreen_redirect(ALWAYS) was removed — GNOME Shell 46's
            // own panel does not use it, and it causes dark compositing artefacts
            // with transparent blurred backgrounds.

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

            // ── Blur background ──────────────────────────────────────────────
            // A zero-size Clutter.Actor is inserted at index 0 in the panel
            // box so it doesn't affect the BoxLayout flow.  Inside it lives
            // an St.Widget with Shell.BlurEffect(BACKGROUND) that is manually
            // kept in sync with the panel's allocation.  The panel itself is
            // given a transparent CSS override so the blur shows through.
            this._blurContainer = new Clutter.Actor({ width: 0, height: 0, reactive: false });
            this._blurActor = new St.Widget({ name: 'mmPanelBlurBackground', reactive: false });
            this._blurEffect = new Shell.BlurEffect({
                mode: Shell.BlurMode.BACKGROUND,
                radius: 15,
                brightness: 0.6,
            });
            this._blurActor.add_effect(this._blurEffect);
            this._blurActor.add_effect(new BlurRepaintEffect(this._blurEffect));
            this._blurContainer.add_child(this._blurActor);
            mmPanelBox.panelBox.insert_child_at_index(this._blurContainer, 0);

            // Keep blur actor geometry in sync with the panel.
            this._blurSyncId = this.connect(
                'notify::allocation', this._syncBlurGeometry.bind(this));
            // Perform an initial sync once the actors are allocated.
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._syncBlurGeometry();
                return GLib.SOURCE_REMOVE;
            });

            // When the wallpaper changes, Shell.BlurEffect(BACKGROUND) holds a
            // stale texture snapshot of the old background.  Recreating the
            // effect forces GNOME Shell to reinitialise its blur pipeline with
            // the new wallpaper texture.
            this._backgroundSettings = new Gio.Settings({
                schema_id: 'org.gnome.desktop.background',
            });
            this._bgChangedId = this._backgroundSettings.connect(
                'changed', this._refreshBlur.bind(this));

            // Make the panel background transparent so the blur shows through.
            this.add_style_class_name('mm-blurred-panel');
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

        _syncBlurGeometry() {
            if (!this._blurActor) return;
            let [x, y] = this.get_position();
            let [w, h] = this.get_size();
            if (w === 0 || h === 0) return;
            this._blurActor.set_position(x, y);
            this._blurActor.set_size(w, h);
        }

        _refreshBlur() {
            if (!this._blurActor) return;
            // Remove and re-add the blur effect so GNOME Shell reinitialises
            // its internal blur pipeline, picking up the new wallpaper texture.
            this._blurActor.remove_all_effects();
            this._blurEffect = new Shell.BlurEffect({
                mode: Shell.BlurMode.BACKGROUND,
                radius: 15,
                brightness: 0.6,
            });
            this._blurActor.add_effect(this._blurEffect);
            this._blurActor.add_effect(new BlurRepaintEffect(this._blurEffect));
        }

        _onDestroy() {
            if (this._bgChangedId) {
                this._backgroundSettings.disconnect(this._bgChangedId);
                this._bgChangedId = 0;
            }
            if (this._blurSyncId) {
                this.disconnect(this._blurSyncId);
                this._blurSyncId = 0;
            }
            if (this._blurContainer) {
                this._blurContainer.destroy();
                this._blurContainer = null;
                this._blurActor = null; // destroyed with container
            }

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

        // Prevent the panel from acquiring the :hover pseudo-class when child
        // buttons are hovered.  Child buttons handle their own :hover normally,
        // but the propagated enter-event arriving at the panel would also trigger
        // St.Widget's default enter handler which sets :hover on the panel,
        // causing the theme to apply a tinted background over the blur.
        vfunc_enter_event(_event) {
            return Clutter.EVENT_PROPAGATE;
        }

        vfunc_leave_event(_event) {
            return Clutter.EVENT_PROPAGATE;
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
