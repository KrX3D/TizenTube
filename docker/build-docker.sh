#!/bin/bash

# AIDEV-NOTE: Docker-based TizenTube WGT builder script
set -e

echo "🐳 Building TizenTube WGT using Docker..."

if [ ! -f "web-cli_Tizen_Studio_5.1_ubuntu-64.bin" ]; then
    aria2c -j 16 -s 16 -x 16 \
        -o "web-cli_Tizen_Studio_5.1_ubuntu-64.bin" \
        --header='Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8' \
        --header='Accept-Language: en-US,en;q=0.6' \
        --header='Referer: https://developer.tizen.org/' \
        -U 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36' \
        https://download.tizen.org/sdk/Installer/tizen-studio_5.1/web-cli_Tizen_Studio_5.1_ubuntu-64.bin

    chmod +x "web-cli_Tizen_Studio_5.1_ubuntu-64.bin"
fi

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Create output directory
mkdir -p "$PROJECT_DIR/output"

echo "📁 Project directory: $PROJECT_DIR"
echo "📦 Output directory: $PROJECT_DIR/output"

# Build Docker image
echo "🔨 Building Docker image..."
docker buildx build --platform linux/amd64 --progress=plain -t tizentube-builder "$PROJECT_DIR"

# Create certificates directory if it doesn't exist
mkdir -p "$PROJECT_DIR/certificates"

# Run Docker container to build WGT
echo "🚀 Running Docker container..."
docker run --platform linux/amd64 --rm \
    -v "$PROJECT_DIR/output:/output" \
    -v "$PROJECT_DIR/certificates:/tizen/tizen-studio-data/keystore/author" \
    tizentube-builder

echo "✅ Build complete!"
echo "📦 TizenTube WGT available at: $PROJECT_DIR/output/TizenTube.wgt"

# Show file info
if [ -f "$PROJECT_DIR/output/TizenTube.wgt" ]; then
    echo "📊 WGT file size: $(ls -lh "$PROJECT_DIR/output/TizenTube.wgt" | awk '{print $5}')"
else
    echo "❌ WGT file not found!"
    exit 1
fi