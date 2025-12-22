#!/usr/bin/env python3

import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk
from services.api_client import ScanRequest

class ScanDialog(Gtk.Dialog):
    
    def __init__(self, parent):
        super().__init__(
            title="New Security Scan",
            transient_for=parent,
            flags=Gtk.DialogFlags.MODAL
        )
        
        self.add_buttons(
            Gtk.STOCK_CANCEL, Gtk.ResponseType.CANCEL,
            "Start Scan", Gtk.ResponseType.OK
        )
        
        self._build_ui()
    
    def _build_ui(self):
        content = self.get_content_area()
        content.set_spacing(16)
        content.set_margin_left(16)
        content.set_margin_right(16)
        content.set_margin_top(16)
        content.set_margin_bottom(16)
        
        url_label = Gtk.Label(label="Target URL:")
        url_label.set_xalign(0)
        content.pack_start(url_label, False, False, 0)
        
        self.url_entry = Gtk.Entry()
        self.url_entry.set_placeholder_text("https://example.com")
        content.pack_start(self.url_entry, False, False, 0)
        
        self.show_all()
    
    def get_scan_request(self) -> ScanRequest:
        return ScanRequest(
            url=self.url_entry.get_text(),
            render_javascript=True,
            timeout=30000,
            crawl_depth=1
        )
