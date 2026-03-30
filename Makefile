SRC_FILES = $(shell find src -type f)
SCHEMA_SOURCES = $(wildcard src/schemas/*.xml)
COMPILED_SCHEMAS = src/schemas/gschemas.compiled
EXTENSION_UUID = $(shell grep -Po '"uuid"\s*:\s*"\K[^"]+' src/metadata.json)
INSTALL_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(EXTENSION_UUID)
EXTENSION_BUNDLE = build/$(EXTENSION_UUID).shell-extension.zip

$(COMPILED_SCHEMAS): $(SCHEMA_SOURCES)
	glib-compile-schemas --strict src/schemas

$(EXTENSION_BUNDLE): $(SRC_FILES) $(COMPILED_SCHEMAS)
	mkdir -p build
	gnome-extensions pack -fo build src

.PHONY: build
build: $(EXTENSION_BUNDLE)

.PHONY: install
install: $(SRC_FILES) $(COMPILED_SCHEMAS)
	mkdir -p $(INSTALL_DIR)
	rsync -a --delete src/ $(INSTALL_DIR)/
	glib-compile-schemas --strict $(INSTALL_DIR)/schemas

.PHONY: clean
clean:
	rm -f $(EXTENSION_BUNDLE)
	rm -f $(COMPILED_SCHEMAS)
	rmdir --ignore-fail-on-non-empty build
