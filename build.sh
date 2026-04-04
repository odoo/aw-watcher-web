#!/usr/bin/env bash

NPM_CONFIG_ALLOW_GIT=true make build-chrome &&
    mkdir -p artifacts/chrome &&
    unzip -o artifacts/chrome.zip -d artifacts/chrome

NPM_CONFIG_ALLOW_GIT=true make build-firefox &&
    mkdir -p artifacts/firefox &&
    unzip -o artifacts/firefox.zip -d artifacts/firefox

echo "✨ All builds completed successfully!"
