#!/usr/bin/env python3

import threading
import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk, GLib

class SettingsView(Gtk.ScrolledWindow):
    
    def __init__(self, main_window):
        super().__init__()
        
        self.main_window = main_window
        self.settings = main_window.settings
        self.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
        
        self._build_ui()
    
    def _build_ui(self):
        main_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=16)
        main_box.set_margin_left(24)
        main_box.set_margin_right(24)
        main_box.set_margin_top(24)
        main_box.set_margin_bottom(24)
        
        title = Gtk.Label()
        title.set_markup('<span size="xx-large" weight="bold">Settings</span>')
        title.set_xalign(0)
        main_box.pack_start(title, False, False, 0)
        
        api_frame = Gtk.Frame(label="API Configuration")
        api_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        api_box.set_margin_left(16)
        api_box.set_margin_right(16)
        api_box.set_margin_top(8)
        api_box.set_margin_bottom(16)
        
        api_label = Gtk.Label(label="API URL:")
        api_label.set_xalign(0)
        api_box.pack_start(api_label, False, False, 0)
        
        self.api_entry = Gtk.Entry()
        self.api_entry.set_text(self.settings.get('api_url'))
        api_box.pack_start(self.api_entry, False, False, 0)

        test_btn = Gtk.Button.new_with_label("Test Connection")
        test_btn.connect('clicked', self._test_connection)
        api_box.pack_start(test_btn, False, False, 0)
        
        api_frame.add(api_box)
        main_box.pack_start(api_frame, False, False, 0)

        ai_frame = Gtk.Frame(label="AI Configuration")
        ai_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        ai_box.set_margin_left(16)
        ai_box.set_margin_right(16)
        ai_box.set_margin_top(8)
        ai_box.set_margin_bottom(16)

        provider_label = Gtk.Label(label="Provider:")
        provider_label.set_xalign(0)
        ai_box.pack_start(provider_label, False, False, 0)
        self.provider_entry = Gtk.Entry()
        self.provider_entry.set_text(str(self.settings.get('llm_provider')))
        ai_box.pack_start(self.provider_entry, False, False, 0)

        model_label = Gtk.Label(label="Model:")
        model_label.set_xalign(0)
        ai_box.pack_start(model_label, False, False, 0)
        self.model_entry = Gtk.Entry()
        self.model_entry.set_text(str(self.settings.get('llm_model')))
        ai_box.pack_start(self.model_entry, False, False, 0)

        temp_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        temp_label = Gtk.Label(label="Temperature:")
        temp_label.set_xalign(0)
        temp_box.pack_start(temp_label, False, False, 0)
        temp_adj = Gtk.Adjustment(float(self.settings.get('llm_temperature')), 0.0, 2.0, 0.1, 0.2, 0)
        self.temp_spin = Gtk.SpinButton.new(temp_adj, 0.1, 2)
        self.temp_spin.set_numeric(True)
        temp_box.pack_start(self.temp_spin, False, False, 0)
        ai_box.pack_start(temp_box, False, False, 0)

        tokens_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        tokens_label = Gtk.Label(label="Max tokens:")
        tokens_label.set_xalign(0)
        tokens_box.pack_start(tokens_label, False, False, 0)
        tokens_adj = Gtk.Adjustment(int(self.settings.get('llm_max_tokens')), 64, 8192, 32, 128, 0)
        self.tokens_spin = Gtk.SpinButton.new(tokens_adj, 32, 0)
        self.tokens_spin.set_numeric(True)
        tokens_box.pack_start(self.tokens_spin, False, False, 0)
        ai_box.pack_start(tokens_box, False, False, 0)

        ai_frame.add(ai_box)
        main_box.pack_start(ai_frame, False, False, 0)
        
        save_btn = Gtk.Button.new_with_label("Save Settings")
        save_btn.get_style_context().add_class('primary')
        save_btn.connect('clicked', self._save_settings)
        main_box.pack_start(save_btn, False, False, 0)
        
        self.add(main_box)
    
    def _save_settings(self, button):
        url = self.api_entry.get_text()
        self.settings.set('api_url', url)
        self.settings.set('llm_provider', self.provider_entry.get_text())
        self.settings.set('llm_model', self.model_entry.get_text())
        self.settings.set('llm_temperature', float(self.temp_spin.get_value()))
        self.settings.set('llm_max_tokens', int(self.tokens_spin.get_value()))
        self.settings.save()
        self.main_window.api_client.set_base_url(url)
        self.main_window.set_status_message("Settings saved")

    def _test_connection(self, button):
        url = (self.api_entry.get_text() or "").strip()
        if not (url.startswith("http://") or url.startswith("https://")):
            self.main_window.app.show_error_dialog(
                "Invalid URL",
                "Please enter a valid URL starting with http:// or https://",
                self.main_window,
            )
            return
        
        def run_test():
            self.main_window.api_client.set_base_url(url)
            ok = self.main_window.api_client.test_connection()
            if ok:
                GLib.idle_add(self.main_window.set_status_message, "API reachable", 3000)
            else:
                GLib.idle_add(self.main_window.set_status_message, "API not reachable", 3000)
        
        threading.Thread(target=run_test, daemon=True).start()
