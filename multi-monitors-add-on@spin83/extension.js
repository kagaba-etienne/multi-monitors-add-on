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

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Gio from 'gi://Gio';

import * as MMLayout from './mmlayout.js';
import * as MMOverview from './mmoverview.js';
import * as MMIndicator from './indicator.js';

const MUTTER_SCHEMA = 'org.gnome.mutter';
const WORKSPACES_ONLY_ON_PRIMARY_ID = 'workspaces-only-on-primary';
const SHOW_INDICATOR_ID = 'show-indicator';
const THUMBNAILS_SLIDER_POSITION_ID = 'thumbnails-slider-position';

// Live ES-module bindings — other modules import these to access shared state.
// These must live here (not on Main) because module namespace objects are sealed
// in GNOME Shell 46 and do not allow setting arbitrary properties.
export let _extension = null;
export let mmPanel = null;
export let mmOverview = null;
export let mmLayoutManager = null;

// Copies prototype methods from source class s to dest class d.
// Skips methods already defined on d. Used to inherit Panel.Panel helpers.
export function copyClass(s, d) {
    let propertyNames = Reflect.ownKeys(s.prototype);
    for (let pName of propertyNames.values()) {
        if (typeof pName === 'symbol') continue;
        if (d.prototype.hasOwnProperty(pName)) continue;
        if (pName === 'prototype') continue;
        if (pName === 'constructor') continue;
        let pDesc = Reflect.getOwnPropertyDescriptor(s.prototype, pName);
        if (typeof pDesc !== 'object') continue;
        Reflect.defineProperty(d.prototype, pName, pDesc);
    }
}

export default class MultiMonitorsAddOnExtension extends Extension {

    enable() {
        _extension = this;

        this._settings = this.getSettings();
        this._mu_settings = new Gio.Settings({ schema_id: MUTTER_SCHEMA });

        this._mmMonitors = 0;
        this.mmIndicator = null;
        mmOverview = null;
        mmLayoutManager = null;
        mmPanel = [];

        this._switchOffThumbnailsMuId = this._mu_settings.connect(
            'changed::' + WORKSPACES_ONLY_ON_PRIMARY_ID,
            this._switchOffThumbnails.bind(this));

        this._showIndicatorId = this._settings.connect(
            'changed::' + SHOW_INDICATOR_ID,
            this._showIndicator.bind(this));
        this._showIndicator();

        mmLayoutManager = new MMLayout.MultiMonitorsLayoutManager();
        this._showPanelId = this._settings.connect(
            'changed::' + MMLayout.SHOW_PANEL_ID,
            mmLayoutManager.showPanel.bind(mmLayoutManager));
        mmLayoutManager.showPanel();

        this._thumbnailsSliderPositionId = this._settings.connect(
            'changed::' + THUMBNAILS_SLIDER_POSITION_ID,
            this._showThumbnailsSlider.bind(this));
        this._relayoutId = Main.layoutManager.connect(
            'monitors-changed', this._relayout.bind(this));
        this._relayout();

        console.log('Multi Monitors Add-On enabled (v' + this.metadata.version + ')');
    }

    disable() {
        Main.layoutManager.disconnect(this._relayoutId);
        this._mu_settings.disconnect(this._switchOffThumbnailsMuId);

        this._settings.disconnect(this._showPanelId);
        this._settings.disconnect(this._thumbnailsSliderPositionId);
        this._settings.disconnect(this._showIndicatorId);

        this._hideIndicator();

        if (mmLayoutManager) {
            mmLayoutManager.hidePanel();
            mmLayoutManager = null;
        }

        this._hideThumbnailsSlider();
        mmPanel = null;
        this._mmMonitors = 0;

        _extension = null;
        console.log('Multi Monitors Add-On disabled');
    }

    _showIndicator() {
        if (this._settings.get_boolean(SHOW_INDICATOR_ID)) {
            if (!this.mmIndicator) {
                this.mmIndicator = Main.panel.addToStatusArea(
                    'MultiMonitorsAddOn',
                    new MMIndicator.MultiMonitorsIndicator());
            }
        } else {
            this._hideIndicator();
        }
    }

    _hideIndicator() {
        if (this.mmIndicator) {
            this.mmIndicator.destroy();
            this.mmIndicator = null;
        }
    }

    _showThumbnailsSlider() {
        if (this._settings.get_string(THUMBNAILS_SLIDER_POSITION_ID) === 'none') {
            this._hideThumbnailsSlider();
            return;
        }

        if (this._mu_settings.get_boolean(WORKSPACES_ONLY_ON_PRIMARY_ID))
            this._mu_settings.set_boolean(WORKSPACES_ONLY_ON_PRIMARY_ID, false);

        if (mmOverview)
            return;

        mmOverview = [];
        for (let idx = 0; idx < Main.layoutManager.monitors.length; idx++) {
            if (idx !== Main.layoutManager.primaryIndex) {
                mmOverview[idx] = new MMOverview.MultiMonitorsOverview(idx);
            }
        }
    }

    _hideThumbnailsSlider() {
        if (!mmOverview)
            return;

        for (let idx = 0; idx < mmOverview.length; idx++) {
            if (mmOverview[idx])
                mmOverview[idx].destroy();
        }
        mmOverview = null;
    }

    _relayout() {
        if (this._mmMonitors !== Main.layoutManager.monitors.length) {
            this._mmMonitors = Main.layoutManager.monitors.length;
            this._hideThumbnailsSlider();
            this._showThumbnailsSlider();
        }
    }

    _switchOffThumbnails() {
        if (this._mu_settings.get_boolean(WORKSPACES_ONLY_ON_PRIMARY_ID))
            this._settings.set_string(THUMBNAILS_SLIDER_POSITION_ID, 'none');
    }
}
