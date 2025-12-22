#!/usr/bin/env python3

import os
import sys
import logging
import threading
from pathlib import Path
from typing import Optional, Dict, Any
import gi

gi.require_version('Gtk', '3.0')
gi.require_version('Gdk', '3.0')
from gi.repository import Gtk, Gdk, GLib, Gio

from ..services.api_client import APIClient
from ..services.settings_manager import SettingsManager
from ..services.notification_service import NotificationService
from ..ui.main_window import MainWindow
from ..ui.splash_screen import SplashScreen
from ..utils.logger import setup_logger

class ShieldEyeApplication(Gtk.Application):
    def __init__(self):
        super().__init__(
            application_id='com.shieldeye.professional',
            flags=Gio.ApplicationFlags.FLAGS_NONE
        )
        
        self.logger = setup_logger('ShieldEye')
        self.settings = SettingsManager()
        self.api_client = APIClient()
        self.notifications = NotificationService()
        
        self.main_window: Optional[MainWindow] = None
        self.splash_screen: Optional[SplashScreen] = None
        
        self.is_initialized = False
        self.startup_tasks = []
        
        self.connect('startup', self.on_startup)
        self.connect('activate', self.on_activate)
        self.connect('shutdown', self.on_shutdown)
        
        self.logger.info("ShieldEye SurfaceScan initialized")
    
    def on_startup(self, app):
        self.logger.info("Starting application...")
        
        self._load_css_theme()
        
        self._initialize_services()
        
        self.splash_screen = SplashScreen(self)
        self.splash_screen.show_all()
        
        threading.Thread(target=self._background_initialization, daemon=True).start()
    
    def on_activate(self, app):
        if not self.main_window:
            self.main_window = MainWindow(self)
            self.add_window(self.main_window)
            try:
                self.main_window.status_bar.update_connection_status(self.api_client.is_connected)
            except Exception:
                pass
        
        if self.is_initialized:
            if self.splash_screen:
                self.splash_screen.destroy()
                self.splash_screen = None
            self.main_window.present()
        else:
            pass
    
    def on_shutdown(self, app):
        self.logger.info("Shutting down application...")
        
        self.settings.save()
        
        self.api_client.cleanup()
        self.notifications.cleanup()
        
        self.logger.info("Application shutdown complete")
    
    def _load_css_theme(self):
        try:
            css_path = Path(__file__).parent.parent.parent / 'assets' / 'styles' / 'simple.css'
            
            provider = Gtk.CssProvider()
            if css_path.exists():
                provider.load_from_path(str(css_path))
            else:
                provider.load_from_data(self._get_fallback_css().encode())
            
            screen = Gdk.Screen.get_default()
            Gtk.StyleContext.add_provider_for_screen(
                screen, 
                provider, 
                Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
            )
            
            self.logger.info("CSS theme loaded successfully")
            
        except Exception as e:
            self.logger.error(f"Failed to load CSS theme: {e}")
    
    def _initialize_services(self):
        try:
            self.settings.load()
            
            api_url = self.settings.get('api_url', 'http://localhost:3000')
            self.api_client.set_base_url(api_url)
            
            self.notifications.initialize()
            
            self.logger.info("Core services initialized")
            
        except Exception as e:
            self.logger.error(f"Failed to initialize services: {e}")
    
    def _background_initialization(self):
        try:
            GLib.idle_add(self.splash_screen.update_progress, 0.2, "Initializing application...")
            
            try:
                if self.api_client.test_connection():
                    self.logger.info("API connection successful")
                    GLib.idle_add(self.splash_screen.update_progress, 0.5, "API connected")
                else:
                    self.logger.info("API offline - continuing in offline mode")
                    GLib.idle_add(self.splash_screen.update_progress, 0.5, "Starting in offline mode")
            except Exception as e:
                self.logger.info(f"API check failed: {e} - continuing offline")
                GLib.idle_add(self.splash_screen.update_progress, 0.5, "Offline mode")
            
            GLib.idle_add(self.splash_screen.update_progress, 0.8, "Loading interface...")
            
            import time
            time.sleep(0.3)
            
            self.is_initialized = True
            GLib.idle_add(self.splash_screen.update_progress, 1.0, "Ready!")
            
            GLib.idle_add(self._complete_initialization)
            
        except Exception as e:
            self.logger.error(f"Background initialization failed: {e}")
            self.is_initialized = True
            GLib.idle_add(self._complete_initialization)
    
    def _complete_initialization(self):
        if self.splash_screen:
            self.splash_screen.destroy()
            self.splash_screen = None
        
        if self.main_window:
            self.main_window.present()
        else:
            self.on_activate(self)
    
    def _get_fallback_css(self) -> str:
        return """
        window {
            background-color: #0a0e1a;
            color: #f8fafc;
        }
        .card {
            background-color: #1a1f2e;
            border: 1px solid #2d3748;
            border-radius: 8px;
            padding: 16px;
        }
        button.primary {
            background: linear-gradient(135deg, #1f8f73 0%, #1f8f73 100%);
            color: white;
            border-radius: 8px;
            padding: 8px 16px;
        }
        .results-area {
            background-color: transparent;
            color: #e2e8f0;
        }
        .results-area.live-log {
            background-color: #242938;
            color: #e2e8f0;
        }
        """
    
    def get_service(self, service_name: str) -> Any:
        services = {
            'api': self.api_client,
            'settings': self.settings,
            'notifications': self.notifications,
            'logger': self.logger
        }
        return services.get(service_name)
    
    def show_error_dialog(self, title: str, message: str, parent=None):
        dialog = Gtk.MessageDialog(
            transient_for=parent or self.main_window,
            flags=Gtk.DialogFlags.MODAL,
            message_type=Gtk.MessageType.ERROR,
            buttons=Gtk.ButtonsType.OK,
            text=title
        )
        dialog.format_secondary_text(message)
        dialog.run()
        dialog.destroy()
    
    def show_info_dialog(self, title: str, message: str, parent=None):
        dialog = Gtk.MessageDialog(
            transient_for=parent or self.main_window,
            flags=Gtk.DialogFlags.MODAL,
            message_type=Gtk.MessageType.INFO,
            buttons=Gtk.ButtonsType.OK,
            text=title
        )
        dialog.format_secondary_text(message)
        dialog.run()
        dialog.destroy()

def create_application() -> ShieldEyeApplication:
    return ShieldEyeApplication()
