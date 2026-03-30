import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {
    ExtensionPreferences,
    gettext as _,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const SETTINGS_SCHEMA = 'org.gnome.shell.extensions.transparent-top-bar-tweaks';

const OPACITY_KEY = 'opacity';
const KEEP_TRANSPARENT_WITH_WINDOWS_KEY = 'keep-transparent-with-windows';
const CONTENT_SHADOW_STRENGTH_KEY = 'content-shadow-strength';
const PANEL_SHADOW_STRENGTH_KEY = 'panel-shadow-strength';
const CONTENT_COLOR_SCHEME_KEY = 'content-color-scheme';
const FORCE_WHITE_IN_OVERVIEW_KEY = 'force-white-in-overview';
const FONT_KEY = 'font';

const DEFAULT_FONT_PREVIEW = 'Cantarell 11';
const SLIDER_COMMIT_DELAY_MS = 180;

export default class TransparentTopBarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings(SETTINGS_SCHEMA);

        const page = new Adw.PreferencesPage({
            title: _('Appearance'),
            icon_name: 'preferences-desktop-theme-symbolic',
        });

        page.add(this._createTransparencyGroup(settings));
        page.add(this._createColorGroup(settings));
        page.add(this._createFontGroup(settings));
        page.add(this._createShadowGroup(settings));

        window.add(page);
        window.set_search_enabled(true);
    }

    _createTransparencyGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Transparency'),
            description: _('Use the slider for opacity and the switch to keep the bar transparent with maximized windows.'),
        });

        const opacityRow = new Adw.ActionRow({
            title: _('Top bar opacity'),
            subtitle: _('0 is fully transparent, 100 is fully opaque.'),
        });

        const opacityBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 12,
            valign: Gtk.Align.CENTER,
            hexpand: true,
        });

        const opacityValueLabel = new Gtk.Label({
            width_chars: 4,
            xalign: 1,
            valign: Gtk.Align.CENTER,
        });

        const opacityScale = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, 0, 100, 1);
        opacityScale.set_digits(0);
        opacityScale.set_draw_value(false);
        opacityScale.set_valign(Gtk.Align.CENTER);
        opacityScale.set_size_request(220, -1);
        opacityScale.set_value(settings.get_int(OPACITY_KEY));
        opacityValueLabel.set_text(`${settings.get_int(OPACITY_KEY)}%`);
        this._bindDebouncedScale(settings, OPACITY_KEY, opacityScale, value => {
            opacityValueLabel.set_text(`${value}%`);
        });

        opacityBox.append(opacityScale);
        opacityBox.append(opacityValueLabel);
        opacityRow.add_suffix(opacityBox);
        opacityRow.activatable_widget = opacityScale;
        group.add(opacityRow);

        const keepTransparentRow = new Adw.SwitchRow({
            title: _('Keep transparent with windows'),
            subtitle: _('Leave the top bar transparent even when a window is maximized or touches it.'),
        });
        settings.bind(
            KEEP_TRANSPARENT_WITH_WINDOWS_KEY,
            keepTransparentRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        group.add(keepTransparentRow);

        return group;
    }

    _createColorGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Color'),
            description: _('Choose whether top bar text and symbolic icons should use a light or dark appearance.'),
        });

        const row = new Adw.ComboRow({
            title: _('Text and symbolic icons'),
            subtitle: _('Application icons keep their original colors.'),
            model: Gtk.StringList.new([
                _('Light'),
                _('Dark'),
            ]),
        });

        const updateSelected = () => {
            row.set_selected(settings.get_string(CONTENT_COLOR_SCHEME_KEY) === 'dark' ? 1 : 0);
        };

        updateSelected();

        row.connect('notify::selected', comboRow => {
            const scheme = comboRow.get_selected() === 1 ? 'dark' : 'light';
            if (settings.get_string(CONTENT_COLOR_SCHEME_KEY) !== scheme) {
                settings.set_string(CONTENT_COLOR_SCHEME_KEY, scheme);
            }
        });

        settings.connect(`changed::${CONTENT_COLOR_SCHEME_KEY}`, updateSelected);
        group.add(row);

        const overviewRow = new Adw.SwitchRow({
            title: _('Force white in overview'),
            subtitle: _('Switch top bar text and symbolic icons to white while the overview is open.'),
        });
        settings.bind(
            FORCE_WHITE_IN_OVERVIEW_KEY,
            overviewRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        group.add(overviewRow);

        return group;
    }

    _createFontGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Font'),
            description: _('Choose a custom top bar font or reset to keep the shell theme default.'),
        });

        const row = new Adw.ActionRow({
            title: _('Top bar font'),
            subtitle: _('Applies to the clock and top bar button labels.'),
        });

        const controls = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            valign: Gtk.Align.CENTER,
        });

        const fontButton = new Gtk.FontButton({
            use_font: true,
            use_size: true,
            valign: Gtk.Align.CENTER,
        });
        fontButton.set_font(settings.get_string(FONT_KEY) || DEFAULT_FONT_PREVIEW);
        fontButton.connect('font-set', button => {
            settings.set_string(FONT_KEY, button.get_font());
        });

        const resetButton = new Gtk.Button({
            label: _('Reset'),
            valign: Gtk.Align.CENTER,
        });
        resetButton.connect('clicked', () => {
            settings.set_string(FONT_KEY, '');
            fontButton.set_font(DEFAULT_FONT_PREVIEW);
        });

        controls.append(fontButton);
        controls.append(resetButton);

        row.add_suffix(controls);
        row.activatable_widget = fontButton;
        group.add(row);

        settings.connect(`changed::${FONT_KEY}`, () => {
            const font = settings.get_string(FONT_KEY);
            fontButton.set_font(font || DEFAULT_FONT_PREVIEW);
        });

        return group;
    }

    _createShadowGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Shadow'),
            description: _('Use the sliders to control how strong the text, icon, and panel shadows look.'),
        });

        group.add(this._createSliderRow(
            settings,
            CONTENT_SHADOW_STRENGTH_KEY,
            _('Text and icon shadow'),
            _('0 disables it, 100 gives the strongest shadow.'),
            '%'
        ));
        group.add(this._createSliderRow(
            settings,
            PANEL_SHADOW_STRENGTH_KEY,
            _('Panel shadow'),
            _('Controls the shadow behind the top bar itself.'),
            '%'
        ));

        return group;
    }

    _createSliderRow(settings, key, title, subtitle, suffix) {
        const row = new Adw.ActionRow({
            title,
            subtitle,
        });

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 12,
            valign: Gtk.Align.CENTER,
            hexpand: true,
        });

        const valueLabel = new Gtk.Label({
            width_chars: 4,
            xalign: 1,
            valign: Gtk.Align.CENTER,
        });

        const scale = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, 0, 100, 1);
        scale.set_digits(0);
        scale.set_draw_value(false);
        scale.set_valign(Gtk.Align.CENTER);
        scale.set_size_request(220, -1);
        scale.set_value(settings.get_int(key));
        valueLabel.set_text(`${settings.get_int(key)}${suffix}`);
        this._bindDebouncedScale(settings, key, scale, value => {
            valueLabel.set_text(`${value}${suffix}`);
        });

        box.append(scale);
        box.append(valueLabel);
        row.add_suffix(box);
        row.activatable_widget = scale;

        return row;
    }

    _bindDebouncedScale(settings, key, scale, updateLabel) {
        let timeoutId = 0;

        const commitValue = () => {
            timeoutId = 0;
            const value = Math.round(scale.get_value());
            if (settings.get_int(key) !== value) {
                settings.set_int(key, value);
            }
            return GLib.SOURCE_REMOVE;
        };

        const scheduleCommit = () => {
            if (timeoutId !== 0) {
                GLib.source_remove(timeoutId);
            }
            timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SLIDER_COMMIT_DELAY_MS, commitValue);
        };

        scale.connect('value-changed', currentScale => {
            updateLabel(Math.round(currentScale.get_value()));
            scheduleCommit();
        });

        settings.connect(`changed::${key}`, () => {
            const value = settings.get_int(key);
            if (Math.round(scale.get_value()) !== value) {
                scale.set_value(value);
                return;
            }
            updateLabel(value);
        });
    }
}
