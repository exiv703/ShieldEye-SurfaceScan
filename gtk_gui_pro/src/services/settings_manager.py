#!/usr/bin/env python3
"""
ShieldEye Professional - Settings Manager
Enterprise settings management with persistence
"""

import json
import os
from pathlib import Path
from typing import Any, Dict, Optional
import logging

class SettingsManager:
    """Professional settings manager with file persistence"""
    
    def __init__(self):
        self.logger = logging.getLogger('SettingsManager')
        
        # Settings file path
        self.settings_dir = Path.home() / '.local' / 'share' / 'shieldeye'
        self.settings_dir.mkdir(parents=True, exist_ok=True)
        self.settings_file = self.settings_dir / 'settings.json'
        
        # Default settings
        self.defaults = {
            'api_url': 'http://localhost:3000',
            'theme': 'dark',
            'window_width': 1400,
            'window_height': 900,
            'auto_refresh': True,
            'refresh_interval': 30,
            'notifications_enabled': True,
            'export_format': 'json',
            'recent_scans_limit': 10,
            'log_level': 'INFO',
            'llm_provider': 'ollama',
            'llm_model': 'llama3.2:3b',
            'llm_temperature': 0.2,
            'llm_max_tokens': 512
        }
        
        # Current settings
        self.settings: Dict[str, Any] = self.defaults.copy()
        
        # Load settings
        self.load()
    
    def get(self, key: str, default: Any = None) -> Any:
        """Get setting value"""
        return self.settings.get(key, default or self.defaults.get(key))
    
    def set(self, key: str, value: Any) -> None:
        """Set setting value"""
        self.settings[key] = value
    
    def load(self) -> bool:
        """Load settings from file"""
        try:
            if self.settings_file.exists():
                with open(self.settings_file, 'r') as f:
                    loaded_settings = json.load(f)
                    
                # Merge with defaults (preserve new defaults)
                self.settings = self.defaults.copy()
                self.settings.update(loaded_settings)
                
                self.logger.info("Settings loaded successfully")
                return True
            else:
                self.logger.info("No settings file found, using defaults")
                return False
                
        except Exception as e:
            self.logger.error(f"Failed to load settings: {e}")
            return False
    
    def save(self) -> bool:
        """Save settings to file"""
        try:
            with open(self.settings_file, 'w') as f:
                json.dump(self.settings, f, indent=2)
            
            self.logger.info("Settings saved successfully")
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to save settings: {e}")
            return False
    
    def reset_to_defaults(self) -> None:
        """Reset all settings to defaults"""
        self.settings = self.defaults.copy()
        self.save()
        self.logger.info("Settings reset to defaults")
    
    def get_all(self) -> Dict[str, Any]:
        """Get all settings"""
        return self.settings.copy()
    
    def update_multiple(self, updates: Dict[str, Any]) -> None:
        """Update multiple settings at once"""
        self.settings.update(updates)
        self.save()
