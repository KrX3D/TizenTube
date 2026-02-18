# TizenTube Icon Requirements

## Required Icons for Tizen WGT Package

Place the following icon files in this directory:

- **icon-256.png** (256x256 px) - Main app icon referenced in config.xml
- **icon-128.png** (128x128 px) - Alternative size for different contexts  
- **icon-64.png** (64x64 px) - Smaller variant

## Icon Design Guidelines

- **Theme**: Dark background with YouTube TV styling
- **Text**: "TizenTube" or "TT" monogram
- **Colors**: Red (#ff0000) accent on dark background (#000000)
- **Style**: Clean, modern, TV-appropriate
- **Format**: PNG with transparency support

## Temporary Placeholder

For development/testing, you can use a solid color 256x256 PNG as a placeholder.
The build process will copy these icons to `dist/assets/icons/` for WGT packaging.