#!/bin/bash
# Check for updates to @gridspace/net-level package
# Run periodically to see if maintainer has fixed the serve-static dependency

echo "Checking @gridspace/net-level package updates..."
echo ""

CURRENT_VERSION=$(pnpm list @gridspace/net-level --depth=0 --json 2>/dev/null | grep -o '"version":"[^"]*"' | head -1 | cut -d'"' -f4)
LATEST_VERSION=$(pnpm view @gridspace/net-level version 2>/dev/null)

echo "Current version: $CURRENT_VERSION"
echo "Latest version:  $LATEST_VERSION"
echo ""

if [ "$CURRENT_VERSION" != "$LATEST_VERSION" ]; then
    echo "✅ Update available! Check changelog at:"
    echo "   https://github.com/gridspace/net-level/releases"
    echo ""
    echo "After updating, check if serve-static dependency is upgraded,"
    echo "then you can remove the pnpm.overrides section from package.json"
else
    echo "Already on latest version"
fi
