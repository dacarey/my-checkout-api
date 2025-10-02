#!/bin/bash

# OpenAPI Specification Comparison Script
# Uses oasdiff (https://github.com/oasdiff/oasdiff) to compare two OpenAPI spec files
# This script specifically compares the Cart API spec files to identify schema differences

set -e

# Color codes for output formatting
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
OASDIFF_VERSION="1.11.7"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SPEC_DIR="$PROJECT_ROOT/openapi"
OUTPUT_DIR="$SCRIPT_DIR/../output"
OASDIFF_BINARY="$SCRIPT_DIR/oasdiff"

# File paths
SOURCE_SPEC="$SPEC_DIR/checkout-openapi.yaml"
# Destination can be a historical/versioned file; change the filename as needed
DESTINATION_SPEC="$SPEC_DIR/checkout-openapi-1.4.2.yaml"

# Output files
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
HTML_OUTPUT="$OUTPUT_DIR/spec-diff-${TIMESTAMP}.html"
MARKDOWN_OUTPUT="$OUTPUT_DIR/spec-diff-${TIMESTAMP}.md"
YAML_OUTPUT="$OUTPUT_DIR/spec-diff-${TIMESTAMP}.yaml"

echo -e "${BLUE}OpenAPI Specification Comparison Tool${NC}"
echo -e "${BLUE}=====================================${NC}"
echo -e "${CYAN}Using oasdiff (https://github.com/oasdiff/oasdiff)${NC}"
echo ""

# Function to install oasdiff
install_oasdiff() {
    echo -e "${YELLOW}Installing oasdiff version ${OASDIFF_VERSION}...${NC}"

    # Detect architecture
    ARCH=$(uname -m)
    case $ARCH in
        x86_64) ARCH="amd64" ;;
        aarch64) ARCH="arm64" ;;
        arm64) ARCH="arm64" ;;
        *) echo -e "${RED}Error: Unsupported architecture: $ARCH${NC}"; exit 1 ;;
    esac

    # Detect OS
    OS=$(uname -s | tr '[:upper:]' '[:lower:]')
    case $OS in
        linux) OS="linux" ;;
        darwin) OS="darwin" ;;
        *) echo -e "${RED}Error: Unsupported OS: $OS${NC}"; exit 1 ;;
    esac

    DOWNLOAD_URL="https://github.com/oasdiff/oasdiff/releases/download/v${OASDIFF_VERSION}/oasdiff_${OASDIFF_VERSION}_${OS}_${ARCH}.tar.gz"
    TEMP_DIR=$(mktemp -d)

    echo -e "${CYAN}Downloading oasdiff from: $DOWNLOAD_URL${NC}"

    if command -v curl &> /dev/null; then
        curl -fsSL "$DOWNLOAD_URL" -o "$TEMP_DIR/oasdiff.tar.gz"
    elif command -v wget &> /dev/null; then
        wget -q "$DOWNLOAD_URL" -O "$TEMP_DIR/oasdiff.tar.gz"
    else
        echo -e "${RED}Error: Neither curl nor wget is available${NC}"
        exit 1
    fi

    echo -e "${CYAN}Extracting oasdiff binary...${NC}"
    tar -xzf "$TEMP_DIR/oasdiff.tar.gz" -C "$TEMP_DIR"

    # Move binary to script directory
    mv "$TEMP_DIR/oasdiff" "$OASDIFF_BINARY"
    chmod +x "$OASDIFF_BINARY"

    # Cleanup
    rm -rf "$TEMP_DIR"

    echo -e "${GREEN}✓ oasdiff installed successfully${NC}"
}

# Check if oasdiff is installed and working
if [ ! -f "$OASDIFF_BINARY" ]; then
    echo -e "${YELLOW}oasdiff not found. Installing...${NC}"
    install_oasdiff
elif ! "$OASDIFF_BINARY" --version &> /dev/null; then
    echo -e "${YELLOW}oasdiff binary appears corrupted. Reinstalling...${NC}"
    rm -f "$OASDIFF_BINARY"
    install_oasdiff
else
    CURRENT_VERSION=$("$OASDIFF_BINARY" --version | grep -o 'version [0-9.]*' | cut -d' ' -f2)
    if [ "$CURRENT_VERSION" != "$OASDIFF_VERSION" ]; then
        echo -e "${YELLOW}oasdiff version mismatch (current: $CURRENT_VERSION, required: $OASDIFF_VERSION). Updating...${NC}"
        rm -f "$OASDIFF_BINARY"
        install_oasdiff
    fi
fi

# Create output directory if it doesn't exist
mkdir -p "$OUTPUT_DIR"

# Check if source files exist
if [ ! -f "$SOURCE_SPEC" ]; then
    echo -e "${RED}Error: Source spec file not found: $SOURCE_SPEC${NC}"
    exit 1
fi

if [ ! -f "$DESTINATION_SPEC" ]; then
    echo -e "${RED}Error: Destination spec file not found: $DESTINATION_SPEC${NC}"
    exit 1
fi

echo -e "${YELLOW}Comparing OpenAPI specifications:${NC}"
echo -e "  Source:      $(basename "$SOURCE_SPEC")"
echo -e "  Destination: $(basename "$DESTINATION_SPEC")"
echo ""

# Show oasdiff version
OASDIFF_VERSION_OUTPUT=$("$OASDIFF_BINARY" --version)
echo -e "${CYAN}Using: $OASDIFF_VERSION_OUTPUT${NC}"
echo ""

# Run summary comparison first
echo -e "${YELLOW}Getting comparison summary...${NC}"
SUMMARY_OUTPUT=$("$OASDIFF_BINARY" summary "$DESTINATION_SPEC" "$SOURCE_SPEC" --exclude-elements description 2>/dev/null || true)

if echo "$SUMMARY_OUTPUT" | grep -q "diff: false"; then
    echo -e "${GREEN}✓ No functional differences detected (excluding descriptions)${NC}"
    echo "$SUMMARY_OUTPUT"
    exit 0
fi

echo "$SUMMARY_OUTPUT"
echo ""

# Check for breaking changes
echo -e "${YELLOW}Checking for breaking changes...${NC}"
BREAKING_OUTPUT=$("$OASDIFF_BINARY" breaking "$DESTINATION_SPEC" "$SOURCE_SPEC" 2>/dev/null || true)

if [ -z "$BREAKING_OUTPUT" ]; then
    echo -e "${GREEN}✓ No breaking changes detected${NC}"
else
    echo -e "${RED}⚠ Breaking changes detected:${NC}"
    echo "$BREAKING_OUTPUT"
fi
echo ""

# Generate detailed reports
echo -e "${YELLOW}Generating detailed reports...${NC}"

# HTML report
echo -e "${CYAN}Generating HTML report...${NC}"
if "$OASDIFF_BINARY" diff "$DESTINATION_SPEC" "$SOURCE_SPEC" \
    --exclude-elements description \
    --format html > "$HTML_OUTPUT" 2>/dev/null; then
    echo -e "${GREEN}✓ HTML report generated: $(basename "$HTML_OUTPUT")${NC}"
else
    echo -e "${RED}✗ Failed to generate HTML report${NC}"
fi

# Markdown report
echo -e "${CYAN}Generating Markdown report...${NC}"
if "$OASDIFF_BINARY" diff "$DESTINATION_SPEC" "$SOURCE_SPEC" \
    --exclude-elements description \
    --format markdown > "$MARKDOWN_OUTPUT" 2>/dev/null; then
    echo -e "${GREEN}✓ Markdown report generated: $(basename "$MARKDOWN_OUTPUT")${NC}"
else
    echo -e "${RED}✗ Failed to generate Markdown report${NC}"
fi

# YAML report
echo -e "${CYAN}Generating YAML report...${NC}"
if "$OASDIFF_BINARY" diff "$DESTINATION_SPEC" "$SOURCE_SPEC" \
    --exclude-elements description \
    --format yaml > "$YAML_OUTPUT" 2>/dev/null; then
    echo -e "${GREEN}✓ YAML report generated: $(basename "$YAML_OUTPUT")${NC}"
else
    echo -e "${RED}✗ Failed to generate YAML report${NC}"
fi

# Console output with key changes
echo -e "${YELLOW}Key Changes Summary:${NC}"
echo ""

# Get version change
VERSION_CHANGE=$("$OASDIFF_BINARY" diff "$DESTINATION_SPEC" "$SOURCE_SPEC" \
    --exclude-elements description 2>/dev/null | grep -A2 "version:" || true)

if [ -n "$VERSION_CHANGE" ]; then
    echo -e "${CYAN}Version Change:${NC}"
    echo "$VERSION_CHANGE" | sed 's/^/  /'
    echo ""
fi

# Show breaking changes status
if [ -z "$BREAKING_OUTPUT" ]; then
    echo -e "${GREEN}✓ All changes are backward compatible${NC}"
else
    echo -e "${RED}⚠ Breaking changes detected - see detailed reports${NC}"
fi

echo ""
echo -e "${BLUE}Generated Reports:${NC}"
echo -e "  Output Directory: $OUTPUT_DIR"
if [ -f "$HTML_OUTPUT" ]; then
    echo -e "  HTML:     $(basename "$HTML_OUTPUT")"
fi
if [ -f "$MARKDOWN_OUTPUT" ]; then
    echo -e "  Markdown: $(basename "$MARKDOWN_OUTPUT")"
fi
if [ -f "$YAML_OUTPUT" ]; then
    echo -e "  YAML:     $(basename "$YAML_OUTPUT")"
fi

echo ""
echo -e "${BLUE}Comparison complete.${NC}"
echo -e "${CYAN}Note: Description-only changes are excluded from analysis for cleaner results.${NC}"
echo -e "${CYAN}Tip: Open the HTML report in a browser for a detailed visual diff.${NC}"