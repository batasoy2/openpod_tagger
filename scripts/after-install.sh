#!/bin/bash

APP_PATH="/opt/openPod Tagger"

# Find chrome-sandbox dynamically (safer)
SANDBOX=$(find "$APP_PATH" -name chrome-sandbox 2>/dev/null)

if [ -f "$SANDBOX" ]; then
    echo "Fixing chrome-sandbox permissions..."
    chown root:root "$SANDBOX"
    chmod 4755 "$SANDBOX"
else
    echo "chrome-sandbox not found!"
fi