#!/usr/bin/env python3

import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk

class HeaderBar(Gtk.HeaderBar):
    
    def __init__(self, main_window):
        super().__init__()
        
        self.main_window = main_window
        
        self.set_show_close_button(True)
        self.set_title("ShieldEye Professional")
        self.set_subtitle("Security Scanner")
        
        self._add_buttons()
    
    def _add_buttons(self):
        menu_btn = Gtk.Button.new_from_icon_name("open-menu-symbolic", Gtk.IconSize.BUTTON)
        menu_btn.set_tooltip_text("Application Menu")
        self.pack_end(menu_btn)
