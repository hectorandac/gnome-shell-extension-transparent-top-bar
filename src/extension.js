import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const SETTINGS_SCHEMA = 'org.gnome.shell.extensions.transparent-top-bar-tweaks';

const OPACITY_KEY = 'opacity';
const KEEP_TRANSPARENT_WITH_WINDOWS_KEY = 'keep-transparent-with-windows';
const CONTENT_SHADOW_STRENGTH_KEY = 'content-shadow-strength';
const PANEL_SHADOW_STRENGTH_KEY = 'panel-shadow-strength';
const CONTENT_COLOR_SCHEME_KEY = 'content-color-scheme';
const FORCE_WHITE_IN_OVERVIEW_KEY = 'force-white-in-overview';
const FONT_KEY = 'font';
const LIGHT_CONTENT_COLOR = '#eeeeee';
const DARK_CONTENT_COLOR = '#111111';
const CONTENT_TRANSITION_DURATION_MS = 300;
const CONTENT_TRANSITION_TIMING_FUNCTION = 'ease-in-out';

export default class TransparentTopBarExtension extends Extension {
    constructor(metadata) {
        super(metadata);

        this._actorSignalIds = null;
        this._windowSignalIds = null;
        this._settings = null;
        this._settingsSignalId = 0;
        this._customStylesheetFile = null;
        this._customStylesheetLoaded = false;
    }

    enable() {
        this._settings = this.getSettings(SETTINGS_SCHEMA);
        this._actorSignalIds = new Map();
        this._windowSignalIds = new Map();

        this._settingsSignalId = this._settings.connect('changed', () => {
            this._syncCustomStylesheet();
            this._updateTransparent();
        });

        this._actorSignalIds.set(Main.overview, [
            Main.overview.connect('showing', this._updateTransparent.bind(this)),
            Main.overview.connect('hiding', this._updateTransparent.bind(this))
        ]);

        this._actorSignalIds.set(Main.sessionMode, [
            Main.sessionMode.connect('updated', this._updateTransparent.bind(this))
        ]);

        for (const metaWindowActor of global.get_window_actors()) {
            this._onWindowActorAdded(metaWindowActor.get_parent(), metaWindowActor);
        }

        this._actorSignalIds.set(global.window_group, [
            global.window_group.connect('child-added', this._onWindowActorAdded.bind(this)),
            global.window_group.connect('child-removed', this._onWindowActorRemoved.bind(this))
        ]);

        this._syncCustomStylesheet();
        this._updateTransparent();
    }

    disable() {
        if (this._settingsSignalId !== 0) {
            this._settings.disconnect(this._settingsSignalId);
            this._settingsSignalId = 0;
        }

        for (const actorSignalIds of [this._actorSignalIds, this._windowSignalIds]) {
            if (!actorSignalIds) {
                continue;
            }
            for (const [actor, signalIds] of actorSignalIds) {
                for (const signalId of signalIds) {
                    actor.disconnect(signalId);
                }
            }
        }
        this._actorSignalIds = null;
        this._windowSignalIds = null;
        this._unloadCustomStylesheet();
        this._customStylesheetFile = null;
        this._settings = null;

        Main.panel.remove_style_class_name('transparent-top-bar');
    }

    _onWindowActorAdded(container, metaWindowActor) {
        const signalEntries = [
            [metaWindowActor, metaWindowActor.connect('notify::allocation', this._updateTransparent.bind(this))],
            [metaWindowActor, metaWindowActor.connect('notify::visible', this._updateTransparent.bind(this))],
        ];

        const metaWindow = metaWindowActor.get_meta_window?.();
        if (metaWindow) {
            signalEntries.push(
                [metaWindow, metaWindow.connect('position-changed', this._updateTransparent.bind(this))],
                [metaWindow, metaWindow.connect('size-changed', this._updateTransparent.bind(this))],
                [metaWindow, metaWindow.connect('notify::maximized-horizontally', this._updateTransparent.bind(this))],
                [metaWindow, metaWindow.connect('notify::maximized-vertically', this._updateTransparent.bind(this))],
                [metaWindow, metaWindow.connect('notify::fullscreen', this._updateTransparent.bind(this))]
            );
        }

        this._windowSignalIds.set(metaWindowActor, signalEntries);
    }

    _onWindowActorRemoved(container, metaWindowActor) {
        const signalEntries = this._windowSignalIds.get(metaWindowActor);
        if (!signalEntries) {
            return;
        }

        for (const [target, signalId] of signalEntries) {
            target.disconnect(signalId);
        }
        this._windowSignalIds.delete(metaWindowActor);
        this._updateTransparent();
    }

    _updateTransparent() {
        if (Main.panel.has_style_pseudo_class('overview') || !Main.sessionMode.hasWindows) {
            this._setTransparent(true);
            return;
        }

        if (this._settings.get_boolean(KEEP_TRANSPARENT_WITH_WINDOWS_KEY)) {
            this._setTransparent(true);
            return;
        }

        if (!Main.layoutManager.primaryMonitor) {
            return;
        }

        // Get all the windows in the active workspace that are in the primary monitor and visible.
        const workspaceManager = global.workspace_manager;
        const activeWorkspace = workspaceManager.get_active_workspace();
        const windows = activeWorkspace.list_windows().filter(metaWindow => {
            return metaWindow.is_on_primary_monitor()
                    && metaWindow.showing_on_its_workspace()
                    && !metaWindow.is_hidden()
                    && metaWindow.get_window_type() !== Meta.WindowType.DESKTOP;
        });

        // Check if at least one window is near enough to the panel.
        const panelTop = Main.panel.get_transformed_position()[1];
        const panelBottom = panelTop + Main.panel.get_height();
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const isNearEnough = windows.some(metaWindow => {
            const verticalPosition = metaWindow.get_frame_rect().y;
            return verticalPosition < panelBottom + 5 * scale;
        });

        this._setTransparent(!isNearEnough);
    }

    _setTransparent(transparent) {
        if (transparent) {
            Main.panel.add_style_class_name('transparent-top-bar');
        } else {
            Main.panel.remove_style_class_name('transparent-top-bar');
        }
    }

    _syncCustomStylesheet() {
        this._ensureCustomStylesheetFile();

        const stylesheet = this._buildCustomStylesheet();
        this._customStylesheetFile.replace_contents(
            stylesheet,
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            null
        );

        const theme = St.ThemeContext.get_for_stage(global.stage)?.get_theme();
        if (!theme) {
            return;
        }

        if (this._customStylesheetLoaded) {
            try {
                theme.unload_stylesheet(this._customStylesheetFile);
            } catch (error) {
                logError(error, `${this.metadata.name}: failed to unload custom stylesheet`);
            }
            this._customStylesheetLoaded = false;
        }

        try {
            theme.load_stylesheet(this._customStylesheetFile);
            this._customStylesheetLoaded = true;
        } catch (error) {
            logError(error, `${this.metadata.name}: failed to load custom stylesheet`);
        }
    }

    _unloadCustomStylesheet() {
        if (!this._customStylesheetLoaded || !this._customStylesheetFile) {
            return;
        }

        const theme = St.ThemeContext.get_for_stage(global.stage)?.get_theme();
        if (!theme) {
            return;
        }

        try {
            theme.unload_stylesheet(this._customStylesheetFile);
        } catch (error) {
            logError(error, `${this.metadata.name}: failed to unload custom stylesheet`);
        }
        this._customStylesheetLoaded = false;
    }

    _ensureCustomStylesheetFile() {
        if (this._customStylesheetFile) {
            return;
        }

        const cacheDirectory = Gio.File.new_for_path(GLib.build_filenamev([
            GLib.get_user_cache_dir(),
            this.uuid,
        ]));
        try {
            cacheDirectory.make_directory_with_parents(null);
        } catch (error) {
            if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)) {
                throw error;
            }
        }

        this._customStylesheetFile = cacheDirectory.get_child('generated-styles.css');
    }

    _buildCustomStylesheet() {
        const opacity = this._getOpacity();
        const fontCss = this._buildFontCss(this._settings.get_string(FONT_KEY));
        const contentColor = this._getContentColor();
        const overviewContentColor = this._getOverviewContentColor(contentColor);
        const {
            textShadow,
            hoverTextShadow,
            iconShadow,
            hoverIconShadow,
        } = this._buildContentShadowCss();
        const panelShadow = this._buildPanelShadowCss();

        return `
#panel.transparent-top-bar,
#panel {
    box-shadow: ${panelShadow};
}

#panel.transparent-top-bar {
    background-color: rgba(0, 0, 0, ${opacity});
}

#panel.transparent-top-bar.unlock-screen,
#panel.transparent-top-bar.login-screen,
#panel.transparent-top-bar:overview {
    background-color: transparent;
}

#panel,
#panel .panel-button,
#panel StLabel {
${fontCss}
}

#panel.transparent-top-bar .panel-button,
#panel .panel-button,
#panel.transparent-top-bar .panel-button StLabel,
#panel .panel-button StLabel,
#panel.transparent-top-bar .panel-button .clock,
#panel .panel-button .clock,
#panel.transparent-top-bar .clock-display-box .clock,
#panel .clock-display-box .clock {
    transition-duration: ${CONTENT_TRANSITION_DURATION_MS}ms;
    transition-property: color, text-shadow;
    transition-timing-function: ${CONTENT_TRANSITION_TIMING_FUNCTION};
    color: ${contentColor};
    text-shadow: ${textShadow};
}

#panel.transparent-top-bar .system-status-icon,
#panel.transparent-top-bar .app-menu-icon > StIcon,
#panel.transparent-top-bar .popup-menu-arrow,
#panel .system-status-icon,
#panel .app-menu-icon > StIcon,
#panel .popup-menu-arrow {
    transition-duration: ${CONTENT_TRANSITION_DURATION_MS}ms;
    transition-property: color, icon-shadow;
    transition-timing-function: ${CONTENT_TRANSITION_TIMING_FUNCTION};
    color: ${contentColor};
    icon-shadow: ${iconShadow};
}

#panel.transparent-top-bar .panel-button#panelActivities .workspace-dot,
#panel .panel-button#panelActivities .workspace-dot {
    transition-duration: ${CONTENT_TRANSITION_DURATION_MS}ms;
    transition-property: background-color;
    transition-timing-function: ${CONTENT_TRANSITION_TIMING_FUNCTION};
    background-color: ${contentColor};
}

#panel:overview .panel-button#panelActivities,
#panel:overview .panel-button#panelActivities StLabel,
#panel:overview .panel-button#panelActivities .clock,
#panel:overview .panel-button#panelActivities StIcon {
    color: ${overviewContentColor};
}

#panel:overview .panel-button,
#panel:overview .panel-button StLabel,
#panel:overview .panel-button .clock,
#panel:overview .clock-display-box .clock {
    color: ${overviewContentColor};
}

#panel:overview .system-status-icon,
#panel:overview .app-menu-icon > StIcon,
#panel:overview .popup-menu-arrow {
    color: ${overviewContentColor};
}

#panel.transparent-top-bar:overview .panel-button#panelActivities .workspace-dot,
#panel:overview .panel-button#panelActivities .workspace-dot,
#panel:overview .panel-button#panelActivities:focus .workspace-dot,
#panel:overview .panel-button#panelActivities:hover .workspace-dot,
#panel:overview .panel-button#panelActivities:checked .workspace-dot,
#panel:overview .panel-button#panelActivities:active .workspace-dot {
    background-color: ${overviewContentColor};
}

#panel.transparent-top-bar:hover .panel-button,
#panel .panel-button:hover,
#panel.transparent-top-bar:hover .panel-button StLabel,
#panel .panel-button:hover StLabel,
#panel.transparent-top-bar:hover .panel-button .clock,
#panel .panel-button:hover .clock,
#panel .panel-button:focus,
#panel .panel-button:focus StLabel,
#panel .panel-button:focus .clock,
#panel .panel-button:checked,
#panel .panel-button:checked StLabel,
#panel .panel-button:checked .clock,
#panel .panel-button:active,
#panel .panel-button:active StLabel,
#panel .panel-button:active .clock {
    text-shadow: ${hoverTextShadow};
}

#panel.transparent-top-bar:hover .system-status-icon,
#panel.transparent-top-bar:hover .app-menu-icon > StIcon,
#panel.transparent-top-bar:hover .popup-menu-arrow,
#panel .panel-button:hover .system-status-icon,
#panel .panel-button:hover .app-menu-icon > StIcon,
#panel .panel-button:hover .popup-menu-arrow,
#panel .panel-button:focus .system-status-icon,
#panel .panel-button:focus .app-menu-icon > StIcon,
#panel .panel-button:focus .popup-menu-arrow,
#panel .panel-button:checked .system-status-icon,
#panel .panel-button:checked .app-menu-icon > StIcon,
#panel .panel-button:checked .popup-menu-arrow,
#panel .panel-button:active .system-status-icon,
#panel .panel-button:active .app-menu-icon > StIcon,
#panel .panel-button:active .popup-menu-arrow {
    icon-shadow: ${hoverIconShadow};
}

#panel.transparent-top-bar:hover .panel-button#panelActivities .workspace-dot,
#panel .panel-button:hover#panelActivities .workspace-dot,
#panel .panel-button:focus#panelActivities .workspace-dot,
#panel .panel-button:checked#panelActivities .workspace-dot,
#panel .panel-button:active#panelActivities .workspace-dot {
    background-color: ${contentColor};
}
`;
    }

    _getOpacity() {
        const opacity = this._settings.get_int(OPACITY_KEY);
        const clamped = Math.max(0, Math.min(100, opacity));
        return (clamped / 100).toFixed(2);
    }

    _getContentColor() {
        return this._settings.get_string(CONTENT_COLOR_SCHEME_KEY) === 'dark'
            ? DARK_CONTENT_COLOR
            : LIGHT_CONTENT_COLOR;
    }

    _getOverviewContentColor(defaultContentColor) {
        return this._settings.get_boolean(FORCE_WHITE_IN_OVERVIEW_KEY)
            ? LIGHT_CONTENT_COLOR
            : defaultContentColor;
    }

    _buildContentShadowCss() {
        const strength = this._getClampedPercent(CONTENT_SHADOW_STRENGTH_KEY);
        if (strength === 0) {
            return {
                textShadow: 'none',
                hoverTextShadow: 'none',
                iconShadow: 'none',
                hoverIconShadow: 'none',
            };
        }

        const baseBlur = Math.max(1, Math.round(1 + strength / 18));
        const hoverBlur = baseBlur + Math.max(1, Math.round(strength / 15));
        const baseAlpha = (0.2 + strength * 0.007).toFixed(2);
        const hoverAlpha = Math.min(1, 0.3 + strength * 0.0075).toFixed(2);

        return {
            textShadow: `0 1px ${baseBlur}px rgba(0, 0, 0, ${baseAlpha})`,
            hoverTextShadow: `0 1px ${hoverBlur}px rgba(0, 0, 0, ${hoverAlpha})`,
            iconShadow: `0 1px ${baseBlur}px rgba(0, 0, 0, ${baseAlpha})`,
            hoverIconShadow: `0 1px ${hoverBlur}px rgba(0, 0, 0, ${hoverAlpha})`,
        };
    }

    _buildPanelShadowCss() {
        const strength = this._getClampedPercent(PANEL_SHADOW_STRENGTH_KEY);
        if (strength === 0) {
            return 'none';
        }

        const offsetY = Math.max(1, Math.round(1 + strength / 20));
        const blur = Math.max(2, Math.round(2 + strength / 8));
        const alpha = (0.08 + strength * 0.0024).toFixed(2);
        return `0 ${offsetY}px ${blur}px rgba(0, 0, 0, ${alpha})`;
    }

    _getClampedPercent(key) {
        const value = this._settings.get_int(key);
        return Math.max(0, Math.min(100, value));
    }

    _buildFontCss(font) {
        if (!font.trim()) {
            return '';
        }

        const fontDescription = Pango.FontDescription.from_string(font);
        const declarations = [];

        const family = fontDescription.get_family();
        if (family) {
            declarations.push(`    font-family: "${this._escapeCssString(family)}";`);
        }

        const size = fontDescription.get_size();
        if (size > 0) {
            const unit = fontDescription.get_size_is_absolute() ? 'px' : 'pt';
            declarations.push(`    font-size: ${Math.round(size / Pango.SCALE)}${unit};`);
        }

        const weight = fontDescription.get_weight();
        if (weight > 0) {
            declarations.push(`    font-weight: ${weight};`);
        }

        switch (fontDescription.get_style()) {
        case Pango.Style.ITALIC:
            declarations.push('    font-style: italic;');
            break;
        case Pango.Style.OBLIQUE:
            declarations.push('    font-style: oblique;');
            break;
        default:
            declarations.push('    font-style: normal;');
            break;
        }

        return declarations.join('\n');
    }

    _escapeCssString(value) {
        return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    }
};
