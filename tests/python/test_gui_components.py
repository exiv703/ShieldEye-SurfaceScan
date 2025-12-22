#!/usr/bin/env python3
"""GUI Component failure testing"""

import sys
import os
from pathlib import Path

# Add src directory to Python path
sys.path.insert(0, str(Path(__file__).parent / "gui" / "src"))

def test_missing_theme_files():
    """Test GUI behavior with missing theme files"""
    print("Testing missing theme files...")
    
    # Backup original theme file
    theme_path = Path(__file__).parent / "gui" / "src" / "shieldeye_gui" / "qss" / "modern_navy.qss"
    backup_path = theme_path.with_suffix(".qss.backup")
    
    try:
        if theme_path.exists():
            theme_path.rename(backup_path)
            print("Theme file temporarily moved")
        
        # Try to create GUI without theme
        from shieldeye_gui.app import create_app
        window, ctx = create_app()
        print("✅ GUI created successfully without theme file")
        return True
        
    except Exception as e:
        print(f"❌ GUI failed without theme file: {e}")
        return False
    finally:
        # Restore theme file
        if backup_path.exists():
            backup_path.rename(theme_path)
            print("Theme file restored")

def test_corrupted_config():
    """Test GUI with corrupted configuration"""
    print("Testing corrupted configuration...")
    
    try:
        # Test with invalid environment variables
        os.environ["SHIELDEYE_API_URL"] = ""
        os.environ["SHIELDEYE_WS_URL"] = ""
        
        from shieldeye_gui.app import create_app
        window, ctx = create_app()
        print("✅ GUI handled empty config gracefully")
        return True
        
    except Exception as e:
        print(f"❌ GUI failed with empty config: {e}")
        return False

def test_import_failures():
    """Test GUI behavior with missing dependencies"""
    print("Testing import failures...")
    
    # This test simulates what happens if key modules are missing
    try:
        # Test importing core modules
        import PyQt6.QtWidgets
        import qasync
        import aiohttp
        import websockets
        import loguru
        
        print("✅ All core dependencies available")
        return True
        
    except ImportError as e:
        print(f"❌ Missing dependency: {e}")
        return False

def test_memory_constraints():
    """Test GUI under memory constraints"""
    print("Testing memory constraints...")
    
    try:
        # Create multiple large objects to simulate memory pressure
        large_objects = []
        for i in range(10):
            large_objects.append(bytearray(10 * 1024 * 1024))  # 10MB each
        
        # Try to create GUI under memory pressure
        from shieldeye_gui.app import create_app
        window, ctx = create_app()
        
        # Clean up
        del large_objects
        
        print("✅ GUI created successfully under memory pressure")
        return True
        
    except Exception as e:
        print(f"❌ GUI failed under memory pressure: {e}")
        return False

def test_file_permissions():
    """Test GUI behavior with file permission issues"""
    print("Testing file permissions...")
    
    try:
        # Test log directory creation
        log_dir = Path.home() / ".local" / "share" / "shieldeye" / "logs"
        
        if log_dir.exists():
            print(f"Log directory exists: {log_dir}")
        else:
            print(f"Log directory will be created: {log_dir}")
        
        # Test if we can write to the log directory
        test_file = log_dir / "permission_test.txt"
        log_dir.mkdir(parents=True, exist_ok=True)
        
        with open(test_file, "w") as f:
            f.write("test")
        
        test_file.unlink()  # Clean up
        
        print("✅ File permissions are correct")
        return True
        
    except Exception as e:
        print(f"❌ File permission issue: {e}")
        return False

if __name__ == "__main__":
    print("=== GUI Component Testing ===\n")
    
    tests = [
        test_import_failures,
        test_file_permissions,
        test_corrupted_config,
        test_memory_constraints,
        test_missing_theme_files,
    ]
    
    results = []
    for test in tests:
        try:
            result = test()
            results.append(result)
        except Exception as e:
            print(f"❌ Test {test.__name__} crashed: {e}")
            results.append(False)
        print()
    
    print("=== GUI COMPONENT TEST RESULTS ===")
    print(f"Tests passed: {sum(results)}/{len(results)}")
    print(f"Tests failed: {len(results) - sum(results)}/{len(results)}")
    
    if not all(results):
        print("⚠️  Some GUI component tests failed!")
