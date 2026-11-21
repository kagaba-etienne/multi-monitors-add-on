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

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as WorkspaceThumbnail from 'resource:///org/gnome/shell/ui/workspaceThumbnail.js';
import * as LayoutManager from 'resource:///org/gnome/shell/ui/layout.js';
import { ANIMATION_TIME } from 'resource:///org/gnome/shell/ui/overview.js';

import { _extension, mmPanel } from './extension.js';

const THUMBNAILS_SLIDER_POSITION_ID = 'thumbnails-slider-position';

// ─── MultiMonitorsOverviewActor ───────────────────────────────────────────────
// Full-monitor actor placed in the overviewGroup. Holds a panel ghost
// (for top-spacing) and a horizontal group that contains the thumbnail slider.

const MultiMonitorsOverviewActor = GObject.registerClass(
class MultiMonitorsOverviewActor extends St.BoxLayout {
    _init(monitorIndex) {
        super._init({
            name: 'mm-overview-' + monitorIndex,
            accessible_name: 'MMOverview@' + monitorIndex,
            vertical: true,
        });

        this._monitorIndex = monitorIndex;
        this.add_constraint(
            new LayoutManager.MonitorConstraint({ index: monitorIndex }));

        // Add an invisible clone of the secondary panel so the overview
        // content starts below it, matching the primary-monitor behaviour.
        this._panelGhost = null;
        if (mmPanel) {
            for (let panel of mmPanel) {
                if (panel && panel.monitorIndex === monitorIndex) {
                    this._panelGhost = new St.Bin({
                        child: new Clutter.Clone({ source: panel }),
                        reactive: false,
                        opacity: 0,
                    });
                    this.add_child(this._panelGhost);
                    break;
                }
            }
        }

        // Horizontal row: [slider | spacer] or [spacer | slider]
        this._group = new St.BoxLayout({
            name: 'mm-overview-group-' + monitorIndex,
            x_expand: true,
            y_expand: true,
        });
        this.add_child(this._group);
    }
});

// ─── MultiMonitorsOverview ────────────────────────────────────────────────────
// Workspace thumbnails for one secondary monitor.

export class MultiMonitorsOverview {
    constructor(monitorIndex) {
        this.monitorIndex = monitorIndex;
        this._settings = _extension.getSettings();

        // ── Thumbnail box ──────────────────────────────────────────────────
        // In GNOME 46 the ThumbnailsBox constructor takes
        //   (scrollAdjustment, monitorIndex).
        // We pass the primary overview's stateAdjustment so that the
        // "should-show" property tracks the WINDOW_PICKER overview state.
        const stateAdj =
            Main.overview._overview._controls._stateAdjustment;

        this._thumbnailsBox = new WorkspaceThumbnail.ThumbnailsBox(
            stateAdj, monitorIndex);
        // Start collapsed so the first appearance animates in.
        this._thumbnailsBox.expandFraction = 0;

        // ── Clip container (enables the slide-in animation) ────────────────
        this._slider = new St.Bin({
            clip_to_allocation: true,
            y_expand: true,
        });
        this._slider.add_child(this._thumbnailsBox);

        // ── Spacer fills the remaining width ──────────────────────────────
        this._spacer = new St.Widget({ x_expand: true });

        // ── Overview actor ────────────────────────────────────────────────
        this._overview = new MultiMonitorsOverviewActor(monitorIndex);
        this._overview._delegate = this;
        this._overview.connect('destroy', this._onActorDestroy.bind(this));

        // ── Signals ───────────────────────────────────────────────────────
        // Slide in/out as the overview shows/hides.
        this._showingId = Main.overview.connect(
            'showing', this._onOverviewShowing.bind(this));
        this._hiddenId = Main.overview.connect(
            'hidden', this._onOverviewHidden.bind(this));

        // React to "should-show" changes (WINDOW_PICKER ↔ APP_GRID switch).
        this._shouldShowId = this._thumbnailsBox.connect(
            'notify::should-show', this._updateSlide.bind(this));

        // React to monitor layout or position-setting changes.
        this._monitorsChangedId = Main.layoutManager.connect(
            'monitors-changed', this._onMonitorsChanged.bind(this));
        this._positionSettingId = this._settings.connect(
            'changed::' + THUMBNAILS_SLIDER_POSITION_ID,
            this._thumbnailsSelectSide.bind(this));

        // Determine left/right placement and populate the group.
        this._onMonitorsChanged();

        // Add to the shell overlay group.
        Main.layoutManager.overviewGroup.add_child(this._overview);

        // Initially hidden — shown when the overview opens.
        this._overview.visible = false;
    }

    // ── Placement ─────────────────────────────────────────────────────────

    _onMonitorsChanged() {
        const monitor = Main.layoutManager.monitors[this.monitorIndex];
        const primary = Main.layoutManager.primaryMonitor;
        this._primaryIsLeft =
            (monitor && primary) ? monitor.x > primary.x : false;
        this._thumbnailsSelectSide();
    }

    _thumbnailsSelectSide() {
        const sett = this._settings.get_string(THUMBNAILS_SLIDER_POSITION_ID);
        this._onLeft =
            sett === 'left' || (sett === 'auto' && this._primaryIsLeft);

        const group = this._overview._group;
        // Clear and re-add in the right order.
        while (group.get_n_children() > 0)
            group.remove_child(group.get_first_child());

        if (this._onLeft) {
            this._thumbnailsBox.remove_style_class_name('workspace-thumbnails');
            this._thumbnailsBox.add_style_class_name(
                'workspace-thumbnails workspace-thumbnails-left');
            group.add_child(this._slider);
            group.add_child(this._spacer);
        } else {
            this._thumbnailsBox.remove_style_class_name(
                'workspace-thumbnails workspace-thumbnails-left');
            this._thumbnailsBox.add_style_class_name('workspace-thumbnails');
            group.add_child(this._spacer);
            group.add_child(this._slider);
        }
    }

    // ── Animation ─────────────────────────────────────────────────────────

    _onOverviewShowing() {
        this._overview.visible = true;
        this._updateSlide();
    }

    _onOverviewHidden() {
        this._overview.visible = false;
        // Reset to collapsed so next open animates in.
        this._thumbnailsBox.expandFraction = 0;
    }

    _updateSlide() {
        // shouldShow is true when the overview is in WINDOW_PICKER state.
        const show = this._thumbnailsBox.shouldShow;
        this._thumbnailsBox.ease({
            expandFraction: show ? 1 : 0,
            duration: ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    // ── Teardown ─────────────────────────────────────────────────────────

    _onActorDestroy() {
        // Disconnect all signals. The actor (and its children, including
        // _thumbnailsBox) will be freed by the GObject lifecycle.
        if (this._showingId) {
            Main.overview.disconnect(this._showingId);
            this._showingId = 0;
        }
        if (this._hiddenId) {
            Main.overview.disconnect(this._hiddenId);
            this._hiddenId = 0;
        }
        if (this._shouldShowId) {
            this._thumbnailsBox.disconnect(this._shouldShowId);
            this._shouldShowId = 0;
        }
        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = 0;
        }
        if (this._positionSettingId) {
            this._settings.disconnect(this._positionSettingId);
            this._positionSettingId = 0;
        }
    }

    destroy() {
        // Removing the actor from the overview group triggers 'destroy',
        // which calls _onActorDestroy and cleans up all signals.
        if (this._overview.get_parent())
            Main.layoutManager.overviewGroup.remove_child(this._overview);
        this._overview.destroy();
    }
}
