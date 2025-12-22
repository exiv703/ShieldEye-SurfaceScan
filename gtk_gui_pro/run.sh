#!/bin/bash
# ShieldEye SurfaceScan - Launch Script

set -Eeuo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ICON_INFO="ℹ️"
ICON_SUCCESS="✅"
ICON_WARNING="⚠️"
ICON_ERROR="❌"
ICON_ROCKET="🚀"
ICON_GUI="🖥️"
ICON_BACKEND="🧱"
ICON_API="🧩"
ICON_DB="🗄️"
ICON_EXIT="👋"

# Script directory (resolve symlinks, so root ./run.sh works)
SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do
    DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
    SOURCE="$(readlink "$SOURCE")"
    [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

print_info() {
    echo -e "${BLUE}${ICON_INFO} [INFO]${NC} $1"
}

start_full_stack_rebuild() {
    print_info "Rebuilding backend images and launching full stack (backend + API + GUI)..."

    check_dependencies
    setup_environment

    if ! command -v docker &> /dev/null || ! docker compose version &> /dev/null; then
        print_error "Docker or Docker Compose is not available. Cannot rebuild backend automatically."
        echo "You can rebuild manually with:"
        echo "  cd \"${PROJECT_ROOT}\" && docker compose build api renderer analyzer"
        echo "  cd \"${PROJECT_ROOT}\" && docker compose up -d postgres redis minio api renderer analyzer"
        return 1
    fi

    if (
        cd "${PROJECT_ROOT}" && \
        docker compose build api renderer analyzer && \
        docker compose up -d postgres redis minio api renderer analyzer
    ); then
        print_success "Backend rebuilt and services started."
    else
        print_error "Failed to rebuild or start backend services."
        echo "Try running manually: cd \"${PROJECT_ROOT}\" && docker compose build api renderer analyzer && docker compose up -d postgres redis minio api renderer analyzer"
        return 1
    fi

    if ! wait_for_api "${SHIELDEYE_API_URL}/health" "${SHIELDEYE_API_TIMEOUT:-60}" "${SHIELDEYE_API_POLL_INTERVAL:-2}"; then
        print_warning "API did not become ready within timeout; GUI may start in offline mode."
    fi

    launch_application
}

print_success() {
    echo -e "${GREEN}${ICON_SUCCESS} [SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}${ICON_WARNING} [WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}${ICON_ERROR} [ERROR]${NC} $1"
}

print_banner() {
    cat <<'EOF'
                                                                                             


  .--.--.     ,---,                         ,--,                  ,---,.                     
 /  /    '. ,--.' |      ,--,             ,--.'|         ,---,  ,'  .' |                     
|  :  /`. / |  |  :    ,--.'|             |  | :       ,---.'|,---.'   |                     
;  |  |--`  :  :  :    |  |,              :  : '       |   | :|   |   .'                     
|  :  ;_    :  |  |,--.`--'_       ,---.  |  ' |       |   | |:   :  |-,      .--,   ,---.   
 \  \    `. |  :  '   |,' ,'|     /     \ '  | |     ,--.__| |:   |  ;/|    /_ ./|  /     \  
  `----.   \|  |   /' :'  | |    /    /  ||  | :    /   ,'   ||   :   .' , ' , ' : /    /  | 
  __ \  \  |'  :  | | ||  | :   .    ' / |'  : |__ .   '  /  ||   |  |-,/___/ \: |.    ' / | 
 /  /`--'  /|  |  ' | :'  : |__ '   ;   /||  | '.'|'   ; |:  |'   :  ;/| .  \  ' |'   ;   /| 
'--'.     / |  :  :_:,'|  | '.'|'   |  / |;  :    ;|   | '/  '|   |    \  \  ;   :'   |  / | 
  `--'---'  |  | ,'    ;  :    ;|   :    ||  ,   / |   :    :||   :   .'   \  \  ;|   :    | 
            `--''      |  ,   /  \   \  /  ---`-'   \   \  /  |   | ,'      :  \  \\   \  /  
                        ---`-'    `----'             `----'   `----'         \  ' ; `----'   
                                                                              `--`           



 ShieldEye SurfaceScan Launcher
--------------------------------
EOF
}

require_command() {
    local cmd="$1"
    local name="${2:-$1}"
    if ! command -v "$cmd" &> /dev/null; then
        print_error "$name is not installed"
        return 1
    fi
    return 0
}

is_port_listening() {
    local port="$1"
    if command -v lsof &> /dev/null; then
        lsof -Pi ":${port}" -sTCP:LISTEN -t >/dev/null 2>&1
        return $?
    fi
    if command -v ss &> /dev/null; then
        ss -ltn 2>/dev/null | awk '{print $4}' | grep -E "(:|\[::\]:)${port}$" >/dev/null 2>&1
        return $?
    fi
    return 1
}

wait_for_api() {
    local url="$1"
    local timeout="${2:-30}"
    local interval="${3:-2}"
    local elapsed=0

    while [[ $elapsed -lt $timeout ]]; do
        if curl -sf "${url}" >/dev/null 2>&1; then
            return 0
        fi
        sleep "$interval"
        elapsed=$((elapsed + interval))
        print_info "Waiting for API... (${elapsed}s/${timeout}s)"
    done

    return 1
}

check_dependencies() {
    print_info "Checking system dependencies..."

    require_command python3 "Python 3" || exit 1
    require_command pkg-config "pkg-config" || exit 1
    require_command curl "curl" || exit 1
    
    # Check Pyhon
    if ! command -v python3 &> /dev/null; then
        print_error "Python 3 is not installed"
        exit 1
    fi
    
    if ! pkg-config --exists gtk+-3.0; then
        print_error "GTK+ 3.0 development libraries not found"
        print_info "Install with: sudo pacman -S gtk3 (Arch) or sudo apt install libgtk-3-dev (Ubuntu)"
        exit 1
    fi
    
    if ! python3 -c "import gi; gi.require_version('Gtk', '3.0'); from gi.repository import Gtk" 2>/dev/null; then
        print_error "PyGObject not found"
        print_info "Install with: sudo pacman -S python-gobject (Arch) or sudo apt install python3-gi (Ubuntu)"
        exit 1
    fi
    
    print_success "All dependencies satisfied"
}

setup_environment() {
    print_info "Setting up environment..."
    
    # Set API URL
    export SHIELDEYE_API_URL="${SHIELDEYE_API_URL:-http://localhost:3000}"
    
    # Set GTK theme
    export GTK_THEME="${GTK_THEME:-Adwaita:dark}"
    
    # Python path
    export PYTHONPATH="${SCRIPT_DIR}/src:${PYTHONPATH:-}"
    
    print_success "Environment configured"
}

install_python_deps() {
    if [ -f "${SCRIPT_DIR}/requirements.txt" ]; then
        print_info "Installing Python dependencies..."
        
        if command -v pip3 &> /dev/null; then
            pip3 install --user -r "${SCRIPT_DIR}/requirements.txt"
        elif command -v pip &> /dev/null; then
            pip install --user -r "${SCRIPT_DIR}/requirements.txt"
        else
            print_warning "pip not found, skipping Python dependency installation"
        fi
    fi
}

install_requirements() {
    print_info "Checking system dependencies and installing Python GUI requirements..."

    # This verifies Python, GTK, PyGObject and other basics.
    check_dependencies

    # Install Python packages for the GTK GUI (gtk_gui_pro/requirements.txt).
    install_python_deps

    print_success "Requirements check and Python dependency installation completed."
    echo "For full system requirements (Docker, Node.js, LLM, etc.), see REQUIREMENTS.md."
}

reset_demo_data() {
    print_info "Resetting analytics data (database tables)..."

    read -rp "This will delete all scans, findings and libraries from the database. Continue? [y/N]: " confirm
    case "$confirm" in
        y|Y|yes|YES)
            ;;
        *)
            print_info "Reset cancelled."
            return 0
            ;;
    esac

    if ! command -v docker &> /dev/null || ! docker compose version &> /dev/null; then
        print_error "Docker or Docker Compose is not available. Cannot reset data automatically."
        echo "You can reset manually with:"
        echo "  cd \"${PROJECT_ROOT}\" && docker compose exec -T postgres psql -U shieldeye -d shieldeye -c 'TRUNCATE TABLE findings, libraries, scripts, vulnerability_cache, scans RESTART IDENTITY CASCADE;'"
        return 1
    fi

    if is_port_listening 3000; then
        print_warning "Port 3000 appears to be already in use. If the API is already running, you can ignore this."
    fi

    if (cd "${PROJECT_ROOT}" && docker compose exec -T postgres psql -U shieldeye -d shieldeye -c "TRUNCATE TABLE findings, libraries, scripts, vulnerability_cache, scans RESTART IDENTITY CASCADE;"); then
        print_success "Analytics data reset completed."
    else
        print_error "Failed to reset analytics data. Check docker logs for details."
        return 1
    fi
}

check_api_connection() {
    print_info "Checking API connection..."
    
    if curl -sf "${SHIELDEYE_API_URL}/health" >/dev/null 2>&1; then
        print_success "API is accessible at ${SHIELDEYE_API_URL}"
        return 0
    fi

    print_warning "API not accessible at ${SHIELDEYE_API_URL}"

    if command -v docker &> /dev/null && docker compose version &> /dev/null; then
        print_info "Attempting to start backend services via Docker Compose..."
        (
          cd "${PROJECT_ROOT}" && \
          docker compose up -d postgres redis minio api renderer analyzer
        )

        if wait_for_api "${SHIELDEYE_API_URL}/health" "${SHIELDEYE_API_TIMEOUT:-30}" "${SHIELDEYE_API_POLL_INTERVAL:-2}"; then
            print_success "Backend started. API is now accessible at ${SHIELDEYE_API_URL}"
            return 0
        else
            print_warning "Backend start attempted, but API is still not reachable. GUI will run in offline mode."
            return 1
        fi
    else
        print_warning "Docker or Docker Compose not available; cannot start backend automatically. GUI will run in offline mode."
        return 1
    fi
}

launch_application() {
    print_info "Launching ShieldEye Professional..."
    
    find "${SCRIPT_DIR}" -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
    
    cd "${SCRIPT_DIR}"
    
    if DBUS_SESSION_BUS_ADDRESS= python3 main.py "$@"; then
        print_success "Application exited normally"
    else
        exit_code=$?
        print_error "Application exited with code ${exit_code}"
        
        case $exit_code in
            1)
                print_info "Check the logs in ~/.local/share/shieldeye/logs/ for details"
                ;;
            130)
                print_info "Application was interrupted by user (Ctrl+C)"
                ;;
            *)
                print_info "Unexpected exit code: ${exit_code}"
                ;;
        esac
        
        exit $exit_code
    fi
}

show_help() {
    echo "ShieldEye Professional - Launch Script"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --help, -h          Show this help message"
    echo "  --mode MODE         Run non-interactively (MODE: full|gui|backend|api|reset|rebuild|exit or 1-7)"
    echo "  --api-url URL       Set API URL (default: http://localhost:3000)"
    echo "  --timeout SECONDS   API readiness timeout (default: 30)"
    echo "  --no-banner         Disable the ASCII banner"
    echo "  --check-deps        Check dependencies only"
    echo "  --install-deps      Install Python GUI dependencies only"
    echo "  --install-reqs      Check deps and install Python GUI requirements"
    echo ""
    echo "Examples:"
    echo "  ./run.sh --mode full"
    echo "  ./run.sh --mode gui"
    echo "  ./run.sh --mode api --api-url http://localhost:3000 --timeout 60"
    echo ""
    echo "Environment Variables:"
    echo "  SHIELDEYE_API_URL   API server URL"
    echo "  GTK_THEME          GTK theme (default: Adwaita:dark)"
    echo "  SHIELDEYE_MODE      Same as --mode"
    echo "  SHIELDEYE_API_TIMEOUT Same as --timeout"
    echo "  SHIELDEYE_NO_BANNER Same as --no-banner"
    echo ""
}

start_gui_only() {
    print_info "Launching GUI only (no backend auto-start)..."
    if pgrep -f "python3[[:space:]].*${SCRIPT_DIR}/main\.py" >/dev/null 2>&1; then
        print_warning "ShieldEye GUI appears to be already running."
        return 1
    fi
    check_dependencies
    setup_environment
    launch_application
}

start_full_stack() {
    print_info "Launching full stack (backend + API + GUI)..."
    check_dependencies
    setup_environment
    check_api_connection || true
    launch_application
}

start_backend_only() {
    print_info "Starting backend services (Postgres, Redis, MinIO, renderer, analyzer, API)..."
    if ! command -v docker &> /dev/null || ! docker compose version &> /dev/null; then
        print_error "Docker or Docker Compose is not available. Cannot start backend automatically."
        echo "You can start backend manually with:"
        echo "  cd \"${PROJECT_ROOT}\" && docker compose up -d postgres redis minio renderer analyzer api"
        return 1
    fi

    if (cd "${PROJECT_ROOT}" && docker compose up -d postgres redis minio renderer analyzer api); then
        print_success "Backend services started."
        echo "To stop them manually: cd \"${PROJECT_ROOT}\" && docker compose down"
    else
        print_error "Failed to start backend services."
        echo "Try running manually: cd \"${PROJECT_ROOT}\" && docker compose up -d postgres redis minio renderer analyzer api"
        return 1
    fi
}

start_api_only() {
    print_info "Starting API service (and its Docker dependencies if needed)..."
    if ! command -v docker &> /dev/null || ! docker compose version &> /dev/null; then
        print_error "Docker or Docker Compose is not available. Cannot start API automatically."
        echo "You can start it manually with:"
        echo "  cd \"${PROJECT_ROOT}\" && docker compose up -d api"
        return 1
    fi

    if (cd "${PROJECT_ROOT}" && docker compose up -d api); then
        sleep 3
        if curl -sf "${SHIELDEYE_API_URL}/health" >/dev/null 2>&1; then
            print_success "API is running at ${SHIELDEYE_API_URL}"
        else
            print_warning "API container started but /health is not responding yet."
            echo "You can check logs with: cd \"${PROJECT_ROOT}\" && docker compose logs api"
        fi
    else
        print_error "Failed to start API service."
        echo "Try running manually: cd \"${PROJECT_ROOT}\" && docker compose up -d api"
        return 1
    fi
}

main() {
    if [[ "${SHIELDEYE_NO_BANNER:-false}" != "true" ]]; then
        print_banner
    fi
    
    # Parse arguments
    local mode="${SHIELDEYE_MODE:-}"
    while [[ $# -gt 0 ]]; do
        case $1 in
            --help|-h)
                show_help
                exit 0
                ;;
            --mode)
                if [[ $# -lt 2 ]]; then
                    print_error "--mode requires an argument"
                    show_help
                    exit 1
                fi
                mode="$2"
                shift 2
                ;;
            --no-banner)
                export SHIELDEYE_NO_BANNER="true"
                shift
                ;;
            --check-deps)
                check_dependencies
                exit 0
                ;;
            --install-deps)
                install_python_deps
                exit 0
                ;;
            --install-reqs)
                install_requirements
                exit 0
                ;;
            --api-url)
                if [[ $# -lt 2 ]]; then
                    print_error "--api-url requires an argument"
                    show_help
                    exit 1
                fi
                export SHIELDEYE_API_URL="$2"
                shift 2
                ;;
            --timeout)
                if [[ $# -lt 2 ]]; then
                    print_error "--timeout requires an argument"
                    show_help
                    exit 1
                fi
                export SHIELDEYE_API_TIMEOUT="$2"
                shift 2
                ;;
            *)
                print_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done

    if [[ -n "${mode}" ]]; then
        case "${mode}" in
            1|full)
                start_full_stack
                ;;
            2|gui)
                start_gui_only
                ;;
            3|backend)
                start_backend_only
                ;;
            4|api)
                start_api_only
                ;;
            5|reset)
                reset_demo_data
                ;;
            8|install|install-reqs)
                install_requirements
                ;;
            7|rebuild|full-rebuild)
                start_full_stack_rebuild
                ;;
            6|exit)
                echo "Goodbye."
                exit 0
                ;;
            *)
                print_error "Unknown mode: ${mode}"
                show_help
                exit 1
                ;;
        esac
        exit 0
    fi

    echo ""
    echo "Choose launch mode:"
    echo "  1) ${ICON_ROCKET} Full stack (backend + API + GUI)"
    echo "  2) ${ICON_GUI} GUI only"
    echo "  3) ${ICON_BACKEND} Backend services only"
    echo "  4) ${ICON_API} API only"
    echo "  5) ${ICON_DB} Reset analytics data (truncate DB)"
    echo "  6) ${ICON_EXIT} Exit"
    echo "  7) ${ICON_ROCKET} Full stack (rebuild backend images + GUI)"
    echo "  8) ${ICON_INFO} Install requirements (check deps + Python GUI packages)"
    echo ""
    read -rp "Enter choice [1-8]: " choice

    case "$choice" in
        1)
            start_full_stack
            ;;
        2)
            start_gui_only
            ;;
        3)
            start_backend_only
            ;;
        4)
            start_api_only
            ;;
        5)
            reset_demo_data
            ;;
        8)
            install_requirements
            ;;
        6)
            echo "Goodbye."
            exit 0
            ;;
        7)
            start_full_stack_rebuild
            ;;
        *)
            print_error "Invalid choice. Please run the script again and choose 1-8."
            exit 1
            ;;
    esac
}

# Handle Ctrl+C gracefully
trap 'echo -e "\n${YELLOW}Interrupted by user${NC}"; exit 130' INT

# Run main function
main "$@"
