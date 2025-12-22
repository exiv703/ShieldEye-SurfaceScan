#!/usr/bin/env python3

import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk

class ExportDialog(Gtk.Dialog):
    
    def __init__(self, parent, scan_id: str):
        super().__init__(
            title="Export Scan Results",
            transient_for=parent,
            flags=Gtk.DialogFlags.MODAL
        )
        
        self.scan_id = scan_id
        
        self.add_buttons(
            Gtk.STOCK_CANCEL, Gtk.ResponseType.CANCEL,
            "Export", Gtk.ResponseType.OK
        )
        
        # Build UI
        self._build_ui()
    
    def _build_ui(self):
        content = self.get_content_area()
        content.set_spacing(16)
        content.set_margin_left(16)
        content.set_margin_right(16)
        content.set_margin_top(16)
        content.set_margin_bottom(16)
        
        format_label = Gtk.Label(label="Export Format:")
        format_label.set_xalign(0)
        content.pack_start(format_label, False, False, 0)
        
        self.format_combo = Gtk.ComboBoxText()
        self.format_combo.append_text("JSON")
        self.format_combo.append_text("PDF")
        self.format_combo.append_text("CSV")
        self.format_combo.append_text("CycloneDX SBOM (JSON)")
        self.format_combo.append_text("VEX (JSON)")
        self.format_combo.set_active(0)
        content.pack_start(self.format_combo, False, False, 0)
        
        self.show_all()

    def get_selected_format(self) -> str:
        text = self.format_combo.get_active_text() or "JSON"
        mapping = {
            "JSON": "json",
            "PDF": "pdf",
            "CSV": "csv",
            "CycloneDX SBOM (JSON)": "cyclonedx",
            "VEX (JSON)": "vex",
        }
        return mapping.get(text, "json")
