# GNOME Shell Extension - Transparent Top Bar Tweaks

A GNOME Shell extension that brings back the transparent top bar and makes the panel appearance configurable from the extension preferences.

This fork started from the feature implementation [removed in GNOME Shell 3.32](https://gitlab.gnome.org/GNOME/gnome-shell/merge_requests/376/) and the original Transparent Top Bar extension, then added a preferences UI for common panel appearance controls.

## Features

- Adjustable top bar opacity from 0 to 100
- Optional transparency even when windows are maximized or touching the panel
- Light or dark text and symbolic icon mode
- Optional white content override while the GNOME overview is open
- Custom top bar font selection
- Adjustable text and icon shadow strength
- Adjustable panel shadow strength

Full-color application icons keep their original colors.

## Compatibility

The extension metadata currently targets GNOME Shell 46 through 50.

## Development

Build the distributable zip:

```bash
make build
```

Install the extension into the local user extension directory:

```bash
make install
```

On X11, reload GNOME Shell after runtime JavaScript changes:

1. Press `Alt+F2`
2. Type `r`
3. Press `Enter`

## License

This program is distributed under the terms of the GNU General Public License, version 2 or later.
