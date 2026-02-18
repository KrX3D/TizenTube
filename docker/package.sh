#!/bin/bash -ex

# AIDEV-NOTE: TizenTube WGT packaging script adapted from Jellyfin
echo "🚀 Starting TizenTube WGT packaging..."

# Set Tizen Studio tools path
export PATH=$PATH:/tizen/tizen-studio/tools/ide/bin

# Create certificate for TizenTube (only if it doesn't exist)
if [ ! -f "/tizen/tizen-studio-data/keystore/author/tizentubecert.p12" ]; then
    echo "📜 Creating new Tizen certificate..."
    tizen certificate -a TizenTube -p 1234 -c NZ -s Auckland -ct Auckland -o TizenTube -n TizenTube -e tizentube@example.org -f tizentubecert -- /tizen/tizen-studio-data/keystore/author
else
    echo "🔄 Using existing Tizen certificate..."
fi

# Add security profile (remove existing first to avoid conflicts)
echo "🔐 Adding security profile..."
tizen security-profiles remove -n TizenTube 2>/dev/null || echo "No existing profile to remove"
tizen security-profiles add -n TizenTube -a /tizen/tizen-studio-data/keystore/author/tizentubecert.p12 -p 1234

# Configure CLI and profiles
echo "⚙️ Configuring profiles..."
tizen cli-config "profiles.path=/tizen/tizen-studio-data/profile/profiles.xml"

# Debug: Check profiles XML
PROFILES_XML="/tizen/tizen-studio-data/profile/profiles.xml"
echo "🔍 Looking for profiles.xml at: $PROFILES_XML"
if [ -f "$PROFILES_XML" ]; then
    echo "✅ Found profiles.xml"
    echo "📄 Current profiles.xml content:"
    cat "$PROFILES_XML"
    
    # Check if XML is valid
    xmllint --noout "$PROFILES_XML" 2>/dev/null || echo "⚠️ XML validation failed, will recreate profiles"
    
    # Update passwords
    sed -i 's/\/tizen\/tizen-studio-data\/keystore\/author\/tizentubecert.pwd/1234/g' "$PROFILES_XML"
    sed -i 's/\/tizen\/tizen-studio-data\/tools\/certificate-generator\/certificates\/distributor\/tizen-distributor-signer.pwd/tizenpkcs12passfordsigner/g' "$PROFILES_XML"
    sed -i 's/password=""/password="tizenpkcs12passfordsigner"/g' "$PROFILES_XML"
    
    # Set appropriate permissions
    chmod 755 "$PROFILES_XML"
    echo "📝 Updated profiles.xml"
    
    echo "📄 Updated profiles.xml content:"
    cat "$PROFILES_XML"
else
    echo "⚠️ profiles.xml not found, will rely on direct packaging"
fi

# Change to project directory
cd /tizen/tizentube-app

# Set build configuration
tizen cli-config default.build.configuration=Release

echo "🔨 Building web package..."
# Build web package (exclude unnecessary files)
tizen build-web --optimize -e ".*" -e "README.md" -e "node_modules/*" -e "package*.json" -e "pnpm-lock.yaml"

echo "📦 Packaging WGT..."
# Move to .buildResult directory to avoid duplicate structure
if [ -d ".buildResult" ]; then
    echo "🔄 Using .buildResult directory for clean packaging..."
    cd .buildResult
fi

# Try packaging without security profile first (for testing)
echo "🧪 Trying basic packaging..."
tizen package -t wgt || {
    echo "❌ Basic packaging failed, trying with profile..."
    tizen package -t wgt -s TizenTube || {
        echo "❌ Profile packaging failed, trying expect script..."
        cd .. && /tizen/expect_script || {
            echo "❌ All packaging methods failed!"
            exit 1
        }
    }
}

echo "📁 Moving WGT to output directory..."
mkdir -p /output
# Find and copy the WGT file (may be in current dir or parent)
if [ -f "TizenTube.wgt" ]; then
    cp TizenTube.wgt /output/
elif [ -f "../TizenTube.wgt" ]; then
    cp ../TizenTube.wgt /output/
else
    echo "❌ Failed to find TizenTube.wgt!"; exit 1
fi

echo "✅ TizenTube WGT packaging complete!"
echo "📦 Output: /output/TizenTube.wgt"

# List the contents for verification
echo "📋 WGT Contents:"
unzip -l /output/TizenTube.wgt