#!/bin/bash
# Package Chrome extension for release

set -e

# Get version from manifest.json
VERSION=$(grep -o '"version": "[^"]*"' manifest.json | cut -d'"' -f4)
echo "Packaging version: $VERSION"

# Create dist directory if not exists
mkdir -p dist

# Create zip file (excluding unnecessary files)
ZIP_NAME="prism-extension-v${VERSION}.zip"
echo "Creating zip: $ZIP_NAME"

# Create zip with all necessary files
zip -r "dist/$ZIP_NAME" \
  manifest.json \
  background.js \
  options.html \
  options.js \
  popup.html \
  popup.js \
  popup.css \
  icons/ \
  -x "*.DS_Store" "*.git*" "dist/*" "package.sh"

echo "Package created: dist/$ZIP_NAME"
echo "Size: $(du -h "dist/$ZIP_NAME" | cut -f1)"