#!/usr/bin/env python3
"""Test invalid environment variables"""

import os
import sys
from pathlib import Path

# Add src directory to Python path
sys.path.insert(0, str(Path(__file__).parent / "gui" / "src"))

def test_invalid_env_vars():
    """Test GUI with invalid environment variables"""
    
    # Test invalid API URL
    os.environ["SHIELDEYE_API_URL"] = "invalid://not-a-url"
    os.environ["SHIELDEYE_WS_URL"] = "invalid://websocket"
    os.environ["SHIELDEYE_THEME"] = "nonexistent_theme"
    
    try:
        from shieldeye_gui.app import create_app
        window, ctx = create_app()
        print("✅ GUI created successfully with invalid env vars")
        return True
    except Exception as e:
        print(f"❌ GUI failed with invalid env vars: {e}")
        return False

def test_missing_env_vars():
    """Test GUI with missing environment variables"""
    
    # Clear all ShieldEye env vars
    for key in list(os.environ.keys()):
        if key.startswith("SHIELDEYE_"):
            del os.environ[key]
    
    try:
        from shieldeye_gui.app import create_app
        window, ctx = create_app()
        print("✅ GUI created successfully with missing env vars")
        return True
    except Exception as e:
        print(f"❌ GUI failed with missing env vars: {e}")
        return False

if __name__ == "__main__":
    print("Testing invalid environment variables...")
    test_invalid_env_vars()
    print("\nTesting missing environment variables...")
    test_missing_env_vars()
