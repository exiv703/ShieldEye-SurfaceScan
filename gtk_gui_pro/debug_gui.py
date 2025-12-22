#!/usr/bin/env python3

import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk, Gdk

class DebugWindow(Gtk.ApplicationWindow):
    def __init__(self, app):
        super().__init__(application=app)
        
        # Window setup
        self.set_title("ShieldEye SurfaceScan - Debug")
        self.set_default_size(800, 600)
        self.set_position(Gtk.WindowPosition.CENTER)
        
        # Load CSS
        self.load_css()
        
        self.create_ui()
        
        print("Debug window created")
    
    def load_css(self):
        css = """
        window {
            background-color: #0a0e1a;
            color: #f8fafc;
        }
        
        .header {
            background-color: #1a1f2e;
            padding: 16px;
            border-bottom: 1px solid #2d3748;
        }
        
        .sidebar {
            background-color: #0f1419;
            border-right: 1px solid #2d3748;
            min-width: 200px;
        }
        
        .content {
            background-color: #0a0e1a;
            padding: 20px;
        }
        
        button {
            background-color: #1f8f73;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            margin: 4px;
        }
        
        button:hover {
            background-color: #26b18e;
        }
        """
        
        provider = Gtk.CssProvider()
        provider.load_from_data(css.encode())
        
        screen = Gdk.Screen.get_default()
        Gtk.StyleContext.add_provider_for_screen(
            screen, 
            provider, 
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
        )
        print("CSS loaded")
    
    def create_ui(self):
        main_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        self.add(main_box)
        
        header = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL)
        header.get_style_context().add_class('header')
        
        title = Gtk.Label(label="🛡️ ShieldEye SurfaceScan")
        title.set_markup('<span size="large" weight="bold">🛡️ ShieldEye SurfaceScan</span>')
        header.pack_start(title, False, False, 0)
        
        main_box.pack_start(header, False, False, 0)
        
        content_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL)
        main_box.pack_start(content_box, True, True, 0)
        
        sidebar = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        sidebar.get_style_context().add_class('sidebar')
        sidebar.set_size_request(200, -1)
        
        buttons = [
            ("📊 Dashboard", self.on_dashboard),
            ("🔍 New Scan", self.on_new_scan),
            ("📋 Results", self.on_results),
            ("⚙️ Settings", self.on_settings)
        ]
        
        for label, callback in buttons:
            btn = Gtk.Button(label=label)
            btn.connect('clicked', callback)
            btn.set_margin_left(8)
            btn.set_margin_right(8)
            btn.set_margin_top(4)
            btn.set_margin_bottom(4)
            sidebar.pack_start(btn, False, False, 0)
        
        content_box.pack_start(sidebar, False, False, 0)
        
        self.content_area = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        self.content_area.get_style_context().add_class('content')
        
        welcome_label = Gtk.Label()
        welcome_label.set_markup('<span size="xx-large" weight="bold">Welcome to ShieldEye SurfaceScan</span>')
        self.content_area.pack_start(welcome_label, False, False, 20)
        
        subtitle = Gtk.Label(label="Professional Security Scanner")
        subtitle.set_markup('<span size="large">Professional Security Scanner</span>')
        self.content_area.pack_start(subtitle, False, False, 10)
        
        status_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        
        status_items = [
            "✅ Application loaded successfully",
            "✅ CSS theme applied",
            "✅ UI components initialized",
            "⚠️ API connection: Offline",
            "ℹ️ Ready for testing"
        ]
        
        for item in status_items:
            label = Gtk.Label(label=item)
            label.set_xalign(0)
            status_box.pack_start(label, False, False, 0)
        
        self.content_area.pack_start(status_box, False, False, 20)
        
        content_box.pack_start(self.content_area, True, True, 0)
        
        print("UI created")
    
    def on_dashboard(self, button):
        print("Dashboard clicked")
        self.update_content("📊 Dashboard", "Dashboard view would be here")
    
    def on_new_scan(self, button):
        print("New Scan clicked")
        self.update_content("🔍 New Scan", "Scan creation form would be here")
    
    def on_results(self, button):
        print("Results clicked")
        self.update_content("📋 Results", "Scan results would be here")
    
    def on_settings(self, button):
        print("Settings clicked")
        self.update_content("⚙️ Settings", "Application settings would be here")
    
    def update_content(self, title, description):
        for child in self.content_area.get_children():
            self.content_area.remove(child)
        
        title_label = Gtk.Label()
        title_label.set_markup(f'<span size="xx-large" weight="bold">{title}</span>')
        self.content_area.pack_start(title_label, False, False, 20)
        
        desc_label = Gtk.Label(label=description)
        self.content_area.pack_start(desc_label, False, False, 10)
        
        back_btn = Gtk.Button(label="← Back to Welcome")
        back_btn.connect('clicked', self.on_back)
        self.content_area.pack_start(back_btn, False, False, 20)
        
        self.content_area.show_all()
    
    def on_back(self, button):
        self.create_ui()
        self.show_all()

class DebugApp(Gtk.Application):
    def __init__(self):
        super().__init__(application_id='com.shieldeye.debug')
        
    def do_activate(self):
        window = DebugWindow(self)
        window.show_all()
        print("Window shown")

def main():
    print("Starting ShieldEye SurfaceScan Debug GUI...")
    app = DebugApp()
    return app.run([])

if __name__ == '__main__':
    import sys
    sys.exit(main())
