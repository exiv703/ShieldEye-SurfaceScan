#!/bin/bash
# ShieldEye Professional - Unified Startup Script
# Launches backend + GUI as one integrated system

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}🛡️  ShieldEye Professional - Integrated Launcher${NC}"
echo -e "${BLUE}=================================================${NC}"
echo ""

# Check dependencies
echo -e "${BLUE}[INFO]${NC} Checking dependencies..."

# Check Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}[ERROR]${NC} Docker is not installed"
    exit 1
fi

# Check Docker Compose
if ! docker compose version &> /dev/null; then
    echo -e "${RED}[ERROR]${NC} Docker Compose is not available"
    exit 1
fi

# Check Python
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}[ERROR]${NC} Python 3 is not installed"
    exit 1
fi

# Check GTK
if ! python3 -c "import gi; gi.require_version('Gtk', '3.0'); from gi.repository import Gtk" 2>/dev/null; then
    echo -e "${RED}[ERROR]${NC} PyGObject (GTK bindings) not found"
    echo -e "${YELLOW}[INFO]${NC} Install with: sudo pacman -S python-gobject (Arch) or sudo apt install python3-gi (Ubuntu)"
    exit 1
fi

echo -e "${GREEN}[SUCCESS]${NC} All dependencies satisfied"
echo ""

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Change to script directory
cd "$SCRIPT_DIR"

# Launch integrated system
echo -e "${BLUE}[INFO]${NC} Starting ShieldEye Professional..."
echo -e "${YELLOW}[NOTE]${NC} This will start both backend (Docker) and GUI"
echo -e "${YELLOW}[NOTE]${NC} Close the GUI window or press Ctrl+C to stop everything"
echo ""

# Run the integrated launcher
python3 launch_integrated.py

echo ""
echo -e "${GREEN}[SUCCESS]${NC} ShieldEye stopped successfully"
