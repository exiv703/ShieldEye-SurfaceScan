#!/usr/bin/env python3

import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk, GLib

class StatusBar(Gtk.Box):
    
    def __init__(self, main_window):
        super().__init__(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        
        self.main_window = main_window
        
        self.get_style_context().add_class('status-bar')
        self.set_margin_left(8)
        self.set_margin_right(8)
        self.set_margin_top(4)
        self.set_margin_bottom(4)
        
        status_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=4)
        self.status_icon = Gtk.Label()
        self.status_icon.set_markup('<span size="small">✓</span>')
        status_box.pack_start(self.status_icon, False, False, 0)
        
        self.status_label = Gtk.Label(label="Ready")
        self.status_label.get_style_context().add_class('status-ready')
        status_box.pack_start(self.status_label, False, False, 0)
        
        self.pack_start(status_box, False, False, 0)
        
        spacer = Gtk.Box()
        self.pack_start(spacer, True, True, 0)
        
        connection_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=4)
        self.connection_icon = Gtk.Label()
        self.connection_icon.set_markup('<span size="small">●</span>')
        connection_box.pack_start(self.connection_icon, False, False, 0)
        
        self.connection_label = Gtk.Label(label="Disconnected")
        self.connection_label.get_style_context().add_class('status-disconnected')
        connection_box.pack_start(self.connection_label, False, False, 0)
        
        self.pack_end(connection_box, False, False, 0)
    
    def set_message(self, message: str, timeout: int = 5000):
        self.status_label.set_text(message)
        if timeout > 0:
            GLib.timeout_add(timeout, lambda: self.status_label.set_text("Ready"))
    
    def update_connection_status(self, connected: bool):
        if connected:
            self.connection_icon.set_markup('<span size="small" foreground="#1f8f73">●</span>')
            self.connection_label.set_text("Connected")
            self.connection_label.get_style_context().remove_class('status-disconnected')
            self.connection_label.get_style_context().add_class('status-connected')
        else:
            self.connection_icon.set_markup('<span size="small" foreground="#dc3545">●</span>')
            self.connection_label.set_text("Disconnected")
            self.connection_label.get_style_context().remove_class('status-connected')
            self.connection_label.get_style_context().add_class('status-disconnected')
