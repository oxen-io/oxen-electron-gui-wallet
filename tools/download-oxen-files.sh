#!/bin/bash

set -e

if [ "$#" -ne 1 ] || [[ "$1" != http* ]]; then
    cat <<EOF >&2
Usage: $0 URL -- download and extract an oxen-core build (typically from https://oxen.rocks)
Some common URLs:
    https://oxen.rocks/oxen-io/oxen-core/oxen-stable-linux-LATEST.tar.xz
    https://oxen.rocks/oxen-io/oxen-core/oxen-stable-win-LATEST.zip
    https://oxen.rocks/oxen-io/oxen-core/oxen-stable-macos-LATEST.tar.xz
    https://oxen.rocks/oxen-io/oxen-core/oxen-dev-linux-LATEST.tar.xz
    https://oxen.rocks/oxen-io/oxen-core/oxen-dev-win-LATEST.zip
    https://oxen.rocks/oxen-io/oxen-core/oxen-dev-macos-LATEST.tar.xz
EOF
    exit 1
fi

if ! [ -f tools/download-oxen-files.sh ] || ! [ -d bin ]; then
    echo "This script needs to be invoked from the oxen-electron-gui-wallet top-level project directory" >&2
    exit 1
fi

tar=tar
if [[ "$($tar --version)" == bsdtar* ]]; then
    tar=gtar
    if ! command -v $tar; then
        echo "GNU tar is required, but your tar is \`bsdtar' and \`gtar' doesn't work." >&2
        echo "This is probably a mac; please install gnutar (e.g. via macports or homebrew)" >&2
        exit 1
    fi
fi

rm -f bin/oxen*

if [[ "$1" = *win*.zip ]]; then
    tmpzip=$(mktemp XXXXXXXXXXXX.zip)
    curl -L -sSo $tmpzip "$1"
    unzip -p $tmpzip '*/oxend.exe' >bin/oxend.exe
    unzip -p $tmpzip '*/oxen-wallet-rpc.exe' >bin/oxen-wallet-rpc.exe
    rm -f $tmpzip

    echo "Extracted:"
    ls -l bin/*.exe
else
    curl -L -sS "$1" | $tar --strip-components=1 -C bin -xJv --no-anchored oxend oxen-wallet-rpc

    echo "Checking downloaded versions:"
    echo -n "oxend: "; ./bin/oxend --version
    echo -n "oxen-wallet-rpc: "; ./bin/oxen-wallet-rpc --version
fi
