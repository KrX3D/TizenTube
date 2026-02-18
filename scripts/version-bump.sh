#!/bin/bash
# TizenTube Version Management Script
# Uses semantic versioning: x.y.z (required for Tizen compatibility)

set -e

# Check for --tag flag and parse arguments properly
CREATE_TAG=false
VERSION=""

for arg in "$@"; do
    case $arg in
        --tag)
            CREATE_TAG=true
            ;;
        --*)
            echo "Unknown option: $arg"
            exit 1
            ;;
        *)
            if [ -z "$VERSION" ]; then
                VERSION="$arg"
            fi
            ;;
    esac
done

# Version is required - no automatic date-based generation
if [ -z "$VERSION" ]; then
    echo "❌ Version argument required!"
    echo "   Usage: $0 <version> [--tag]"
    echo "   Example: $0 1.0.0 --tag"
    echo ""
    echo "📋 Tizen version requirements:"
    echo "   - Format: x.y.z (e.g., 1.0.0, 2.1.5)"
    echo "   - x and y must be ≤ 255"
    echo "   - z must be ≤ 65535"
    exit 1
fi

# Use Node.js script to update versions reliably
node scripts/update-version.js "$VERSION"

# Optional: Create git tag
if [ "$CREATE_TAG" = true ]; then
    echo ""
    echo "🏷️  Creating git tag: v$VERSION"
    git add package.json standalone/src/config.xml
    git commit -m "chore: bump version to $VERSION"
    git tag "v$VERSION"
    echo "✅ Tagged version v$VERSION"
    echo "   Run 'git push origin v$VERSION' to trigger release"
fi