#!/usr/bin/env python3

import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk, GLib, Gdk

class SplashScreen(Gtk.Window):
    
    def __init__(self, app):
        super().__init__(type=Gtk.WindowType.POPUP)
        
        self.app = app
        
        self.set_title("ShieldEye SurfaceScan")
        self.set_default_size(500, 300)
        self.set_position(Gtk.WindowPosition.CENTER)
        self.set_decorated(False)
        self.set_resizable(False)
        self.set_modal(True)
        
        self.get_style_context().add_class('splash-screen')
        
        self._build_ui()
        
        self.set_keep_above(True)
    
    def _build_ui(self):
        main_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=0)
        main_box.get_style_context().add_class('splash-container')
        self.add(main_box)
        
        top_spacer = Gtk.Box()
        top_spacer.set_size_request(-1, 60)
        main_box.pack_start(top_spacer, False, False, 0)
        
        logo_section = self._create_logo_section()
        main_box.pack_start(logo_section, False, False, 0)
        
        middle_spacer = Gtk.Box()
        middle_spacer.set_size_request(-1, 40)
        main_box.pack_start(middle_spacer, False, False, 0)
        
        progress_section = self._create_progress_section()
        main_box.pack_start(progress_section, False, False, 0)
        
        bottom_spacer = Gtk.Box()
        main_box.pack_start(bottom_spacer, True, True, 0)
        
        footer = self._create_footer()
        main_box.pack_end(footer, False, False, 20)
    
    def _create_logo_section(self):
        section = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=16)
        section.set_halign(Gtk.Align.CENTER)
        
        logo = Gtk.Label(label="")
        logo.get_style_context().add_class('splash-logo')
        section.pack_start(logo, False, False, 0)
        
        title = Gtk.Label()
        title.set_markup('<span size="xx-large" weight="bold">ShieldEye SurfaceScan</span>')
        title.get_style_context().add_class('splash-title')
        section.pack_start(title, False, False, 0)
        
        subtitle = Gtk.Label(label="Web Surface Security Scanner")
        subtitle.get_style_context().add_class('splash-subtitle')
        section.pack_start(subtitle, False, False, 0)
        
        return section
    
    def _create_progress_section(self):
        section = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        section.set_halign(Gtk.Align.CENTER)
        section.set_margin_left(60)
        section.set_margin_right(60)
        
        self.progress_bar = Gtk.ProgressBar()
        self.progress_bar.set_size_request(300, 6)
        self.progress_bar.get_style_context().add_class('splash-progress')
        section.pack_start(self.progress_bar, False, False, 0)
        
        self.status_label = Gtk.Label(label="Initializing...")
        self.status_label.get_style_context().add_class('splash-status')
        section.pack_start(self.status_label, False, False, 0)
        
        return section
    
    def _create_footer(self):
        footer = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL)
        footer.set_halign(Gtk.Align.CENTER)
        
        info = Gtk.Label(label="Version 2.0.0 • 2025 ShieldEye SurfaceScan")
        info.get_style_context().add_class('splash-footer')
        footer.pack_start(info, False, False, 0)
        
        return footer
    
    def update_progress(self, fraction: float, status: str):
        self.progress_bar.set_fraction(max(0.0, min(1.0, fraction)))
        self.status_label.set_text(status)
        
        while Gtk.events_pending():
            Gtk.main_iteration()
        
    def close_splash(self):
        self.destroy()
